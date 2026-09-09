import type { DrawerId } from "./types";

type SidebarProps = {
  activeDrawer: DrawerId;
  onOpenDrawer: (drawer: Exclude<DrawerId, null>) => void;
  onNotice: (message: string) => void;
};

const SceneIcon = ({ kind }: { kind: "plan" | "write" | "support" }) => (
  <span className="flex h-5 w-5 items-center justify-center text-[13px] text-[#77766f]" aria-hidden="true">
    {kind === "plan" ? "◇" : kind === "write" ? "≡" : "○"}
  </span>
);

export function Sidebar({ activeDrawer, onOpenDrawer, onNotice }: SidebarProps) {
  const drawerButton = (
    id: Exclude<DrawerId, null>,
    label: string,
    icon: string,
  ) => (
    <button
      type="button"
      onClick={() => onOpenDrawer(id)}
      className={`group flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors ${
        activeDrawer === id
          ? "bg-[#ecece8] font-medium text-[#252521]"
          : "text-[#77766f] hover:bg-[#efefeb] hover:text-[#34342f]"
      }`}
    >
      <span className="flex h-5 w-5 items-center justify-center text-[13px]" aria-hidden="true">
        {icon}
      </span>
      {label}
    </button>
  );

  return (
    <aside className="flex w-[208px] shrink-0 flex-col border-r border-[#e6e5e0] bg-[#f3f3f0] px-3 pb-4 pt-5">
      <div className="mb-7 flex h-8 items-center gap-2.5 px-2">
        <div className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#1d1d1a] text-[13px] font-semibold tracking-[-0.03em] text-white">
          S
        </div>
        <div>
          <div className="text-[14px] font-semibold tracking-[-0.02em] text-[#1f1f1c]">Sugar Agent</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[#999890]">Studio Workspace</div>
        </div>
      </div>

      <nav aria-label="主导航" className="flex min-h-0 flex-1 flex-col">
        <div>
          <p className="mb-1.5 px-2.5 text-[10px] font-medium uppercase tracking-[0.13em] text-[#aaa9a1]">
            工作场景
          </p>
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2.5 rounded-md bg-white px-2.5 text-left text-[13px] font-medium text-[#22221f] shadow-[0_1px_0_rgba(0,0,0,0.03)] ring-1 ring-black/[0.04]"
          >
            <SceneIcon kind="plan" />
            策划执行
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#3c725f]" />
          </button>
          <button
            type="button"
            onClick={() => onNotice("材料撰写场景即将支持")}
            className="mt-0.5 flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-[#9b9a93] hover:bg-[#efefeb]"
          >
            <SceneIcon kind="write" />
            材料撰写
            <span className="ml-auto text-[9px] text-[#b4b3ac]">即将支持</span>
          </button>
          <button
            type="button"
            onClick={() => onNotice("客服场景即将支持")}
            className="mt-0.5 flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-[#9b9a93] hover:bg-[#efefeb]"
          >
            <SceneIcon kind="support" />
            客服
            <span className="ml-auto text-[9px] text-[#b4b3ac]">即将支持</span>
          </button>
        </div>

        <div className="mt-7">
          <p className="mb-1.5 px-2.5 text-[10px] font-medium uppercase tracking-[0.13em] text-[#aaa9a1]">
            项目
          </p>
          {drawerButton("files", "项目资料", "▱")}
          {drawerButton("brain", "项目大脑", "◎")}
        </div>

        <div className="mt-auto border-t border-[#e4e3de] pt-3">
          {drawerButton("activity", "活动记录", "↗")}
          <button
            type="button"
            onClick={() => onNotice("设置功能将在后续版本开放")}
            className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-[#88877f] hover:bg-[#efefeb] hover:text-[#34342f]"
          >
            <span className="flex h-5 w-5 items-center justify-center text-[14px]" aria-hidden="true">⌁</span>
            设置
          </button>
        </div>
      </nav>

      <div className="mt-4 flex items-center gap-2.5 px-2 py-1.5">
        <div className="grid h-7 w-7 place-items-center rounded-full bg-[#dddcd5] text-[11px] font-semibold text-[#55554f]">
          WZ
        </div>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-[#4d4c46]">Studio 成员</p>
          <p className="text-[10px] text-[#aaa9a1]">内部 Demo</p>
        </div>
      </div>
    </aside>
  );
}
