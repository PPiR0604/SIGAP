import type { SigapRepository } from "./repo.js";
export type Repository = {
    [K in keyof SigapRepository]: SigapRepository[K] extends (
        ...args: infer A
    ) => infer R
        ? (...args: A) => R | Promise<R>
        : never;
};
