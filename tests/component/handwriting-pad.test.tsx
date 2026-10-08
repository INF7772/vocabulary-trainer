import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HandwritingPad } from "../../src/components/HandwritingPad";

describe("HandwritingPad", () => {
  it("renders an optional tracing outline without adding it to the drawing", () => {
    const { container, rerender } = render(
      <HandwritingPad drawing={[]} guide={"\u3058"} onChange={() => undefined} />,
    );

    expect(container.querySelector("svg text")?.textContent).toBe("\u3058");
    expect(container.querySelectorAll("polyline")).toHaveLength(0);

    rerender(<HandwritingPad drawing={[]} onChange={() => undefined} />);
    expect(container.querySelector("svg text")).toBeNull();
    expect(screen.getByRole("img")).toBeVisible();
  });
});
