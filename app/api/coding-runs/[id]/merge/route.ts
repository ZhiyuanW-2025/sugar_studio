export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    { error: "Sugar Agent 当前不自动执行 GitHub Merge 或共享分支 rebase。" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
