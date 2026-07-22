import type { GardenSignal } from "@/lib/garden";

type GardenSceneProps = {
  stage: number;
  mood?: "morning" | "night";
  signals?: GardenSignal[];
  streak?: number;
};

export function GardenScene({
  stage,
  mood = "morning",
  signals = [],
  streak = 0,
}: GardenSceneProps) {
  const signalSet = new Set(signals);
  const showStreak = streak >= 3 || signalSet.has("streak");

  return (
    <section className={`garden-scene garden-${mood} tree-stage-${stage}`} aria-label="樱花庭院">
      <div className="garden-sky" />
      <div className="sun-haze" />
      <div className="sun-disc" />
      <div className="distant-hill hill-left" />
      <div className="distant-hill hill-right" />
      <div className="cloud cloud-left" />
      <div className="cloud cloud-right" />
      <div className="garden-ground">
        <div className="garden-fence">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="water-ribbon" />
        <div className="pond" />
        <div className="stone-path">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        {showStreak ? (
          <div className="auto-decor streak-flags" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : null}
        <div className="sakura-tree">
          <div className="tree-trunk">
            <span className="tree-knot" />
          </div>
          <div className="tree-crown crown-back" />
          <div className="tree-crown crown-left" />
          <div className="tree-crown crown-main" />
          <div className="tree-crown crown-right" />
          <span className="blossom-dot blossom-one" />
          <span className="blossom-dot blossom-two" />
          <span className="blossom-dot blossom-three" />
          <span className="blossom-dot blossom-four" />
          <span className="blossom-dot blossom-five" />
        </div>
        <div className="garden-bench">
          <span />
        </div>
        <div className="lantern lantern-left" />
        <div className="tea-table">
          <span />
        </div>
        {signalSet.has("study") ? (
          <div className="auto-decor study-books" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        {signalSet.has("fitness") ? (
          <div className="auto-decor training-corner" aria-hidden="true">
            <span />
            <span />
          </div>
        ) : null}
        {signalSet.has("sleep") ? (
          <div className="auto-decor rest-lamp" aria-hidden="true">
            <span />
          </div>
        ) : null}
        {signalSet.has("life") ? (
          <div className="auto-decor watering-can" aria-hidden="true">
            <span />
          </div>
        ) : null}
        {signalSet.has("creation") ? (
          <div className="auto-decor easel" aria-hidden="true">
            <span />
          </div>
        ) : null}
        {signalSet.has("work") ? (
          <div className="auto-decor focus-board" aria-hidden="true">
            <span />
          </div>
        ) : null}
        <div className="flower-bed flower-bed-left">
          <span />
          <span />
          <span />
        </div>
        <div className="flower-bed flower-bed-right">
          <span />
          <span />
          <span />
        </div>
        <div className="petal petal-one" />
        <div className="petal petal-two" />
        <div className="petal petal-three" />
        <div className="petal petal-four" />
      </div>
    </section>
  );
}
