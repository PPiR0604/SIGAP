import { createHmac, timingSafeEqual } from "node:crypto";
import { SupabaseGateway } from "../supabase/client.js";
export type Role = "admin" | "petugas" | "viewer";
export interface Membership {
    user_id: string;
    organization_id: string | null;
    role: Role | null;
    status: "pending" | "active" | "disabled";
    scopes: string[];
    display_name: string;
}
export interface Principal {
    userId: string;
    sessionId: string;
    expiresAt: number;
    token: string;
    membership: Membership;
}
export class AccessError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
    ) {
        super(code);
    }
}
export class AuthService {
    constructor(readonly gateway: SupabaseGateway) {}
    async authenticate(header?: string): Promise<Principal> {
        if (!header?.startsWith("Bearer ") || header.length > 16384)
            throw new AccessError(401, "UNAUTHORIZED");
        const token = header.slice(7);
        let user: any, claims: any;
        try {
            user = await this.gateway.auth("user", undefined, token);
            claims = JSON.parse(
                Buffer.from(token.split(".")[1], "base64url").toString(),
            );
        } catch {
            throw new AccessError(401, "UNAUTHORIZED");
        }
        if (
            !user.id ||
            user.is_anonymous ||
            claims.sub !== user.id ||
            !claims.session_id ||
            !Number.isFinite(claims.exp) ||
            claims.exp * 1000 <= Date.now()
        )
            throw new AccessError(401, "UNAUTHORIZED");
        if (
            !(await this.gateway.call("session.valid", {
                session_id: claims.session_id,
                user_id: user.id,
            }))
        )
            throw new AccessError(401, "SESSION_REVOKED");
        let membership = await this.gateway.call<Membership>("profile.ensure", {
            user_id: user.id,
            display_name: user.user_metadata?.display_name ?? "",
        });
        // One-time installer allowlist, never a role/email supplied in the API body or user metadata.
        if (
            membership.status === "pending" &&
            !membership.role &&
            !membership.organization_id &&
            user.email_confirmed_at &&
            user.email?.toLowerCase() ===
                this.gateway.settings.bootstrapAdminEmail
        ) {
            await this.gateway.call("bootstrap.admin", {
                email: user.email,
                organization_id: this.gateway.settings.organizationId,
            });
            membership = await this.gateway.call<Membership>("profile.get", {
                user_id: user.id,
            });
        }
        return {
            userId: user.id,
            sessionId: claims.session_id,
            expiresAt: claims.exp * 1000,
            token,
            membership,
        };
    }
    active(p: Principal) {
        if (
            p.membership.status !== "active" ||
            !p.membership.role ||
            p.membership.organization_id !==
                this.gateway.settings.organizationId
        )
            throw new AccessError(403, "ACCOUNT_INACTIVE");
    }
    async scope(p: Principal, contextId: string) {
        this.active(p);
        if (p.membership.role === "viewer")
            throw new AccessError(403, "READ_ONLY_ROLE");
        try {
            await this.gateway.call("scope.check", {
                actor_id: p.userId,
                context_id: contextId,
            });
        } catch {
            throw new AccessError(403, "SCOPE_DENIED");
        }
    }
    async session(p: Principal, s: any) {
        this.active(p);
        if (
            !s ||
            s.organization_id !== p.membership.organization_id ||
            (p.membership.role !== "admin" && s.owner_user_id !== p.userId)
        )
            throw new AccessError(404, "RESOURCE_NOT_FOUND");
        await this.scope(p, s.context_id);
    }
    async stillAuthorized(
        userId: string,
        sessionId: string,
        contextId: string,
    ) {
        if (
            !(await this.gateway.call("session.valid", {
                session_id: sessionId,
                user_id: userId,
            }))
        )
            throw new AccessError(401, "SESSION_REVOKED");
        return this.gateway.call("scope.check", {
            actor_id: userId,
            context_id: contextId,
        });
    }
    capability(
        p: Principal,
        contextId: string,
        tool: string,
        writeReference?: Record<string, unknown>,
    ) {
        const encoded = Buffer.from(
            JSON.stringify({
                actor_id: p.userId,
                auth_session_id: p.sessionId,
                organization_id: p.membership.organization_id,
                context_id: contextId,
                tool,
                write_reference: writeReference,
                exp: Math.min(Date.now() + 300000, p.expiresAt),
            }),
        ).toString("base64url");
        return (
            encoded +
            "." +
            createHmac("sha256", this.gateway.settings.gatewaySecret)
                .update(encoded)
                .digest("hex")
        );
    }
    verifyCapability(value: string) {
        if (value.length > 16384 || value.split(".").length !== 2)
            throw new AccessError(401, "INVALID_CAPABILITY");
        const [encoded, signature] = value.split(".");
        const expected = createHmac(
            "sha256",
            this.gateway.settings.gatewaySecret,
        )
            .update(encoded ?? "")
            .digest("hex");
        if (
            !signature ||
            signature.length !== expected.length ||
            !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        )
            throw new AccessError(401, "INVALID_CAPABILITY");
        const p = JSON.parse(Buffer.from(encoded, "base64url").toString());
        if (
            !Number.isFinite(p.exp) ||
            p.exp <= Date.now() ||
            p.organization_id !== this.gateway.settings.organizationId
        )
            throw new AccessError(401, "EXPIRED_CAPABILITY");
        return p;
    }
}
declare module "fastify" {
    interface FastifyRequest {
        principal?: Principal;
    }
}
