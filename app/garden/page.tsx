import { AppShell } from "@/components/app-shell";
import { GardenScene } from "@/components/garden-scene";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { getGardenData } from "@/lib/data";

const decorations = ["长椅", "灯笼", "花圃", "小桥", "风铃"];

export default async function GardenPage() {
  const session = await requireSession();
  const { gardenState } = await getGardenData(session.userId);

  return (
    <AppShell active="garden">
      <PageHeader eyebrow="庭院" title="小树正在慢慢开花" />

      <section className="garden-detail">
        <GardenScene mood="morning" stage={gardenState.treeStage} />
        <aside className="growth-panel">
          <h2>樱花树 Lv. {gardenState.treeStage}</h2>
          <div className="progress-track">
            <span style={{ width: `${gardenState.progressPercent}%` }} />
          </div>
          <p>
            {gardenState.treeStage >= 6
              ? "樱花树已经满开。"
              : `距离下一阶段还需要 ${gardenState.remainingSunlight} 阳光。`}
          </p>
          <div className="decor-grid">
            {decorations.map((decor) => (
              <button key={decor} type="button">
                {decor}
              </button>
            ))}
          </div>
        </aside>
      </section>
    </AppShell>
  );
}
