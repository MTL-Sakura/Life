import { AppShell } from "@/components/app-shell";
import { GardenScene } from "@/components/garden-scene";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { getGardenData } from "@/lib/data";

const decorations = [
  { name: "木长椅", mark: "椅", state: "已摆放" },
  { name: "石灯笼", mark: "灯", state: "已点亮" },
  { name: "春花圃", mark: "花", state: "成长中" },
  { name: "青石路", mark: "路", state: "已铺好" },
];

export default async function GardenPage() {
  const session = await requireSession();
  const { gardenState, profile } = await getGardenData(session.userId);

  return (
    <AppShell active="garden">
      <PageHeader eyebrow="庭院" title="小树正在慢慢开花" />

      <section className="garden-detail">
        <GardenScene mood="morning" stage={gardenState.treeStage} />
        <aside className="growth-panel">
          <div className="growth-heading">
            <p className="eyebrow">成长</p>
            <h2>樱花树 Lv. {gardenState.treeStage}</h2>
          </div>
          <div className="progress-track" aria-label="樱花树成长进度">
            <span style={{ width: `${gardenState.progressPercent}%` }} />
          </div>
          <p>
            {gardenState.treeStage >= 6
              ? "樱花树已经满开，今天的努力会继续让庭院变得更丰盛。"
              : `再收集 ${gardenState.remainingSunlight} 阳光，樱花树就会进入下一阶段。`}
          </p>
          <div className="garden-stats" aria-label="庭院资源">
            <span>
              <strong>{profile.sunlight}</strong>
              阳光
            </span>
            <span>
              <strong>{profile.water}</strong>
              水滴
            </span>
            <span>
              <strong>{profile.coins}</strong>
              樱花币
            </span>
          </div>
          <div className="decor-grid">
            {decorations.map((decor) => (
              <article className="decor-card" key={decor.name}>
                <span className="decor-mark">{decor.mark}</span>
                <div>
                  <h3>{decor.name}</h3>
                  <p>{decor.state}</p>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </AppShell>
  );
}
