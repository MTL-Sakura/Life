type GardenSceneProps = {
  stage: number;
  mood?: "morning" | "night";
};

export function GardenScene({ stage, mood = "morning" }: GardenSceneProps) {
  return (
    <section className={`garden-scene garden-${mood}`} aria-label="樱花庭院">
      <div className="sun-haze" />
      <div className="distant-hill hill-left" />
      <div className="distant-hill hill-right" />
      <div className="cloud cloud-left" />
      <div className="cloud cloud-right" />
      <div className="garden-ground">
        <div className="pond" />
        <div className="stone-path">
          <span />
          <span />
          <span />
        </div>
        <div className={`sakura-tree tree-stage-${stage}`}>
          <div className="tree-crown crown-back" />
          <div className="tree-crown crown-left" />
          <div className="tree-crown crown-main" />
          <div className="tree-crown crown-right" />
          <div className="tree-trunk" />
        </div>
        <div className="garden-bench" />
        <div className="lantern lantern-left" />
        <div className="flower-bed flower-bed-left" />
        <div className="flower-bed flower-bed-right" />
        <div className="petal petal-one" />
        <div className="petal petal-two" />
        <div className="petal petal-three" />
      </div>
    </section>
  );
}
