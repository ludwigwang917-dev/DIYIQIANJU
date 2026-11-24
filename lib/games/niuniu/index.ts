import { registerGame } from "../../core/registry.ts";
import { niuniuModule } from "./module.ts";
import { niuniuStrategies } from "./strategies.ts";

registerGame(niuniuModule, niuniuStrategies);

export { niuniuModule, niuniuStrategies };
