import energyRibbon from "../assets/brand/mason-forge/mason-forge-energy-fullwidth.webp";
import { digitalForgeLogo } from "./LogoPreview";

export default function ControlCenterCanvas() {
  return (
    <main className="control-center-canvas">
      <img
        className="control-center-logo"
        src={digitalForgeLogo}
        alt="Mason Forge — Engineering Intelligence"
      />

      <div className="control-center-energy" aria-hidden="true">
        <img className="energy-layer energy-base" src={energyRibbon} alt="" />
        <img
          className="energy-layer energy-current energy-current-a"
          src={energyRibbon}
          alt=""
        />
        <img
          className="energy-layer energy-current energy-current-b"
          src={energyRibbon}
          alt=""
        />
        <i className="energy-spark energy-spark-1" />
        <i className="energy-spark energy-spark-2" />
        <i className="energy-spark energy-spark-3" />
        <i className="energy-spark energy-spark-4" />
        <i className="energy-spark energy-spark-5" />
      </div>
    </main>
  );
}
