import { describe, it, expect } from "vitest";
import { autoScrollDelta, moveEntry, placementFromPointer } from "./reorder";

const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
const ids = (entries: readonly { id: string }[]) => entries.map((e) => e.id).join("");

describe("moveEntry", () => {
    it("places the dragged entry before the target by default", () => {
        expect(ids(moveEntry(list, "c", "a"))).toBe("cab");
    });

    it("places the dragged entry after the target when asked", () => {
        expect(ids(moveEntry(list, "a", "b", "after"))).toBe("bac");
    });

    it("can move an entry to the very end of the list", () => {
        expect(ids(moveEntry(list, "a", "c", "after"))).toBe("bca");
    });

    it("does not mutate the original list", () => {
        const original = [...list];
        moveEntry(list, "c", "a");
        expect(list).toEqual(original);
    });

    it.each([
        ["already right before the target", "a", "b", "before"],
        ["already right after the target", "b", "a", "after"],
    ] as const)("returns the same list when the entry is %s", (_case, dragged, target, placement) => {
        expect(moveEntry(list, dragged, target, placement)).toBe(list);
    });

    it.each([
        ["the entry is dropped on itself", "a", "a"],
        ["the dragged entry is unknown", "x", "a"],
        ["the target is unknown", "a", "x"],
    ])("returns the same list when %s", (_case, dragged, target) => {
        expect(moveEntry(list, dragged, target)).toBe(list);
    });
});

describe("placementFromPointer", () => {
    const rect = { top: 100, height: 60 };

    it("returns before in the upper half of the card", () => {
        expect(placementFromPointer(110, rect)).toBe("before");
    });

    it("returns after in the lower half of the card", () => {
        expect(placementFromPointer(150, rect)).toBe("after");
    });
});

describe("autoScrollDelta", () => {
    const bounds = { top: 100, bottom: 500 };

    it("does not scroll away from the edges", () => {
        expect(autoScrollDelta(300, bounds)).toBe(0);
    });

    it("scrolls up near the top edge", () => {
        expect(autoScrollDelta(110, bounds)).toBeLessThan(0);
    });

    it("scrolls down near the bottom edge", () => {
        expect(autoScrollDelta(490, bounds)).toBeGreaterThan(0);
    });

    it("scrolls faster closer to the edge and caps the speed past it", () => {
        expect(autoScrollDelta(495, bounds)).toBeGreaterThan(autoScrollDelta(460, bounds));
        expect(autoScrollDelta(900, bounds)).toBe(autoScrollDelta(500, bounds));
    });
});
