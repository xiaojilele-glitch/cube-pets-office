import { Router } from "express";
import { registerFeishuIngressRoutes } from "../feishu/ingress.js";
import { registerFeishuRelayRoutes } from "../feishu/relay.js";
import {
  createFeishuBridgeRuntime,
  getDefaultFeishuBridgeRuntime,
  type CreateFeishuBridgeRuntimeOptions,
  type FeishuBridgeRuntime,
} from "../feishu/runtime.js";

export function createFeishuRouter(runtime?: FeishuBridgeRuntime): Router {
  const router = Router();
  const resolvedRuntime = runtime ?? getDefaultFeishuBridgeRuntime();
  registerFeishuIngressRoutes(router, resolvedRuntime);
  registerFeishuRelayRoutes(router, resolvedRuntime);
  return router;
}

export function createFeishuRouterWithOptions(
  options: CreateFeishuBridgeRuntimeOptions = {}
): Router {
  return createFeishuRouter(createFeishuBridgeRuntime(options));
}

const feishuRouter = createFeishuRouter();

export default feishuRouter;
