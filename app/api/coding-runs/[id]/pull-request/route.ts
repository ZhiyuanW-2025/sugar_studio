export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    { error: "本地仓库模式暂不创建 GitHub Pull Request。请使用显式 Commit 与 Push 流程。" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
