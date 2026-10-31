import "../src/config.js";
import { loadConfig } from "../src/config.js";
import { SupabaseGateway } from "../src/supabase/client.js";
const email = process.argv.find((a) => a.startsWith("--email="))?.slice(8),
    config = loadConfig();
if (!email || !config.supabase)
    throw new Error("Set Supabase settings and --email=VERIFIED_EMAIL.");
console.log(
    await new SupabaseGateway(config.supabase).call("bootstrap.admin", {
        email,
        organization_id: config.supabase.organizationId,
    }),
);
