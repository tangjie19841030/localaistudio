import { render, screen } from "@testing-library/react";
import { PanelToggleButton, type PanelToggleVariant } from "./PanelToggleButton";

const cases: Array<[
  PanelToggleVariant,
  "left" | "right",
  boolean,
  boolean,
]> = [
  ["edge", "left", false, false],
  ["edge", "left", true, true],
  ["edge", "right", false, true],
  ["edge", "right", true, false],
  ["strip", "left", false, false],
  ["strip", "left", true, true],
  ["strip", "right", false, true],
  ["strip", "right", true, false],
];

describe("PanelToggleButton 箭头方向", () => {
  it.each(cases)(
    "%s %s expanded=%s 指向%s",
    (variant, side, expanded, pointsRight) => {
      render(
        <PanelToggleButton
          side={side}
          variant={variant}
          label="切换侧栏"
          expanded={expanded}
          onClick={() => {}}
        />,
      );

      const svg = screen.getByRole("button", { name: "切换侧栏" }).querySelector("svg");
      expect(svg).toBeInTheDocument();
      if (pointsRight) {
        expect(svg).toHaveStyle({ transform: "scaleX(-1)" });
      } else {
        expect(svg).not.toHaveStyle({ transform: "scaleX(-1)" });
      }
    },
  );
});
