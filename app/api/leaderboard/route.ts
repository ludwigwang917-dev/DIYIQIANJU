import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { placeLabel, type LeaderboardData, type PlayerRow, type RecentRow, type StrategyRow } from "@/lib/leaderboard";

type Num = number | null;

/** 全站汇总：按玩法、最近几趟、生涯赢得最多 / 输得最多的人。 */
export async function GET() {
  try {
    const db = await getDb();

    const [totals] = await db.all<{ players: Num; runs: Num; winningRuns: Num; totalNet: Num; totalBuyIn: Num }>(sql`
      SELECT COUNT(DISTINCT device_id) AS players, COUNT(*) AS runs,
             SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END) AS winningRuns,
             SUM(net) AS totalNet, SUM(buy_in) AS totalBuyIn
      FROM runs`);

    const byStrategy = await db.all<StrategyRow>(sql`
      SELECT strategy, COUNT(*) AS runs, COUNT(DISTINCT device_id) AS players,
             SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END) AS winningRuns,
             SUM(buy_in) AS totalBuyIn, SUM(net) AS totalNet, SUM(rounds) AS totalRounds
      FROM runs GROUP BY strategy ORDER BY runs DESC`);

    const recentRaw = await db.all<Omit<RecentRow, "place"> & { country: string | null; region: string | null; city: string | null }>(sql`
      SELECT p.nickname AS nickname, r.strategy AS strategy, r.net AS net, r.rounds AS rounds,
             r.reason AS reason, r.created_at AS createdAt, r.country AS country, r.region AS region, r.city AS city
      FROM runs r JOIN players p ON p.device_id = r.device_id
      ORDER BY r.id DESC LIMIT 20`);

    // 每人一行：地区取最近一趟，玩法取用得最多的那种。
    const playerSql = (order: "DESC" | "ASC") => sql`
      WITH agg AS (
        SELECT device_id, COUNT(*) AS runs, SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END) AS winningRuns,
               SUM(net) AS totalNet, MAX(id) AS lastId
        FROM runs GROUP BY device_id
      ),
      fav AS (
        SELECT device_id, strategy, ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY COUNT(*) DESC, MAX(id) DESC) AS rk
        FROM runs GROUP BY device_id, strategy
      )
      SELECT p.nickname AS nickname, a.runs AS runs, a.winningRuns AS winningRuns, a.totalNet AS totalNet,
             f.strategy AS strategy, r.country AS country, r.region AS region, r.city AS city
      FROM agg a
      JOIN players p ON p.device_id = a.device_id
      JOIN runs r ON r.id = a.lastId
      JOIN fav f ON f.device_id = a.device_id AND f.rk = 1
      ORDER BY a.totalNet ${sql.raw(order)} LIMIT 10`;
    type RawPlayer = Omit<PlayerRow, "place"> & { country: string | null; region: string | null; city: string | null };
    const withPlace = ({ country, region, city, ...rest }: RawPlayer): PlayerRow => ({
      ...rest,
      place: placeLabel(country, region, city),
    });

    const data: LeaderboardData = {
      totals: {
        players: totals?.players ?? 0,
        runs: totals?.runs ?? 0,
        winningRuns: totals?.winningRuns ?? 0,
        totalNet: totals?.totalNet ?? 0,
        totalBuyIn: totals?.totalBuyIn ?? 0,
      },
      byStrategy,
      recent: recentRaw.map(({ country, region, city, ...rest }) => ({ ...rest, place: placeLabel(country, region, city) })),
      topPlayers: (await db.all<RawPlayer>(playerSql("DESC"))).filter((row) => row.totalNet > 0).map(withPlace),
      bottomPlayers: (await db.all<RawPlayer>(playerSql("ASC"))).filter((row) => row.totalNet < 0).map(withPlace),
    };
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("leaderboard GET", error);
    return Response.json({ error: "排行榜暂时打不开" }, { status: 500 });
  }
}
