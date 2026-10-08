import { describe, expect, it } from "vitest";

import {
  choiceShortcutIndex,
  isEditableKeyboardTarget,
} from "../../src/utils/keyboard";

describe("practice keyboard controls", () => {
  it.each([
    ["1", 0],
    ["2", 1],
    ["3", 2],
    ["4", 3],
    ["5", null],
    ["Enter", null],
  ])("maps %s to its visible choice", (key, expected) => {
    expect(choiceShortcutIndex({ key })).toBe(expected);
  });

  it("does not hijack shortcuts while the user edits text or uses modifiers", () => {
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");

    expect(isEditableKeyboardTarget(input)).toBe(true);
    expect(isEditableKeyboardTarget(editable)).toBe(true);
    expect(choiceShortcutIndex({ key: "1", target: input })).toBeNull();
    expect(choiceShortcutIndex({ key: "1", ctrlKey: true })).toBeNull();
  });
});
