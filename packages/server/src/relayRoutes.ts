/* eslint-disable max-lines -- relay-settings 与 relays 目录路由集中注册，与 http.ts 同策略。 */
import { Hono } from "hono";
import { ServiceCollection, IRelayChannelService } from "@zcode/services";
import { formatZodError } from "@zcode/shared";
import {
  fetchRelayChannelModelsInputSchema,
  relayChannelSelectionSchema,
  saveRelayChannelInputSchema,
} from "@zcode/services";

function getRelayService(services: ServiceCollection) {
  const service = services.getOptional(IRelayChannelService);
  if (!service) {
    throw new Error("Relay Channel 服务未注册");
  }
  return service;
}

function serviceError(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

/** 中转渠道 HTTP 路由。鉴权复用全局 token 中间件（/api/* 已保护），不另加。 */
export function registerRelayRoutes(app: Hono, services: ServiceCollection): void {
  app.get("/api/relay-settings", async (c) => {
    try {
      return c.json(await getRelayService(services).listChannels());
    } catch (error: unknown) {
      return c.json(serviceError(error), 500);
    }
  });

  app.post("/api/relay-settings", async (c) => {
    const parsed = saveRelayChannelInputSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: `Invalid request body: ${formatZodError(parsed.error)}` }, 400);
    }
    try {
      return c.json(await getRelayService(services).saveChannel(parsed.data));
    } catch (error: unknown) {
      return c.json(serviceError(error), 400);
    }
  });

  app.put("/api/relay-settings/:id", async (c) => {
    const parsed = saveRelayChannelInputSchema.safeParse({
      ...(await c.req.json()),
      providerId: c.req.param("id"),
    });
    if (!parsed.success) {
      return c.json({ error: `Invalid request body: ${formatZodError(parsed.error)}` }, 400);
    }
    try {
      return c.json(await getRelayService(services).saveChannel(parsed.data));
    } catch (error: unknown) {
      return c.json(serviceError(error), 400);
    }
  });

  app.delete("/api/relay-settings/:id", async (c) => {
    try {
      await getRelayService(services).deleteChannel(c.req.param("id"));
      return c.json({ ok: true });
    } catch (error: unknown) {
      return c.json(serviceError(error), 400);
    }
  });

  // 脱敏目录：永远不含明文 key，供 composer chips 与外部展示使用。
  app.get("/api/relays", async (c) => {
    try {
      return c.json(await getRelayService(services).listChannels());
    } catch (error: unknown) {
      return c.json(serviceError(error), 500);
    }
  });

  app.get("/api/relays/:id/groups", async (c) => {
    try {
      const channels = await getRelayService(services).listChannels();
      const channel = channels.find((item) => item.providerId === c.req.param("id"));
      if (!channel) return c.json({ error: "Relay channel not found" }, 404);
      return c.json(channel.groups);
    } catch (error: unknown) {
      return c.json(serviceError(error), 500);
    }
  });

  app.post("/api/relay-settings/:id/groups/:groupId/models/fetch", async (c) => {
    const parsed = fetchRelayChannelModelsInputSchema.safeParse({
      ...(await c.req.json()),
      providerId: c.req.param("id"),
      groupId: c.req.param("groupId"),
    });
    if (!parsed.success) {
      return c.json({ error: `Invalid request body: ${formatZodError(parsed.error)}` }, 400);
    }
    try {
      return c.json({
        models: await getRelayService(services).fetchChannelModels(parsed.data),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("不在上游返回中") ? 400 : 502;
      return c.json({ error: message }, status);
    }
  });

  app.get("/api/thread-relay-selection", async (c) => {
    const threadId = c.req.query("threadId")?.trim();
    if (!threadId) return c.json({ error: "Missing threadId" }, 400);
    try {
      return c.json({
        selection: await getRelayService(services).getThreadSelection(threadId),
      });
    } catch (error: unknown) {
      return c.json(serviceError(error), 500);
    }
  });

  app.put("/api/thread-relay-selection", async (c) => {
    const body = (await c.req.json()) as { threadId?: unknown; selection?: unknown };
    const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
    if (!threadId) return c.json({ error: "Missing threadId" }, 400);
    const parsed =
      body.selection == null ? null : relayChannelSelectionSchema.safeParse(body.selection);
    if (parsed === undefined || (parsed !== null && !parsed.success)) {
      return c.json({ error: "Invalid selection" }, 400);
    }
    try {
      return c.json({
        selection: await getRelayService(services).setThreadSelection(
          threadId,
          parsed === null ? null : parsed.data,
        ),
      });
    } catch (error: unknown) {
      return c.json(serviceError(error), 400);
    }
  });
}
