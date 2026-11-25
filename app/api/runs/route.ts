import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { players, runs } from "@/db/schema";
import { geoFromHeaders, parseRunUpload } from "@/lib/leaderboard";

/** 上传“你”的一趟。同一个 clientKey 只记一次。不防作弊（负责人决定）。 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "格式不对" }, { status: 400 });
  }
  const run = parseRunUpload(body);
  if (typeof run === "string") return Response.json({ error: run }, { status: 400 });

  try {
    const db = await getDb();
    const [player] = await db.select().from(players).where(eq(players.deviceId, run.deviceId)).limit(1);
    if (!player) return Response.json({ error: "先设一个昵称" }, { status: 409 });

    const geo = geoFromHeaders(request.headers);
    await db
      .insert(runs)
      .values({ ...run, net: run.cashOut - run.buyIn, ...geo })
      .onConflictDoNothing({ target: runs.clientKey });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("runs POST", error);
    return Response.json({ error: "暂时存不进去，稍后再试" }, { status: 500 });
  }
}
