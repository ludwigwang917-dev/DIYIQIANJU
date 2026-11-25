import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { players } from "@/db/schema";
import { cleanNickname, isId } from "@/lib/leaderboard";

/** 设置或修改昵称。一台浏览器一个 deviceId，没有密码。 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "格式不对" }, { status: 400 });
  }
  const nickname = cleanNickname(body.nickname);
  if (!isId(body.deviceId)) return Response.json({ error: "deviceId 不对" }, { status: 400 });
  if (!nickname) return Response.json({ error: "昵称要 1–16 个字" }, { status: 400 });

  try {
    const db = await getDb();
    await db
      .insert(players)
      .values({ deviceId: body.deviceId, nickname })
      .onConflictDoUpdate({ target: players.deviceId, set: { nickname, updatedAt: sql`CURRENT_TIMESTAMP` } });
    return Response.json({ nickname });
  } catch (error) {
    console.error("players POST", error);
    return Response.json({ error: "暂时存不进去，稍后再试" }, { status: 500 });
  }
}
