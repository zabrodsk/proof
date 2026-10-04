import { test, expect } from "@playwright/test";

test("the bottom work menu stays visible outside the scroll list", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  for (let index = 0; index < 10; index++) {
    const created = await request.post("/api/v1/documents", {
      data: {
        title: `Menu clipping work ${index}`,
        text: "A short draft for testing the work menu.",
      },
    });
    expect(created.status()).toBe(201);
  }

  await page.goto("/app");
  const workList = page.locator(".ps-work-list");
  await expect
    .poll(() => workList.locator(".ps-work").count())
    .toBeGreaterThanOrEqual(10);
  await expect
    .poll(() =>
      workList.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await workList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  const bottomWork = workList.locator(".ps-work").last();
  await bottomWork.getByRole("button", { name: /^Options for / }).click();
  const menu = page.locator("#ps-project-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Delete" })).toBeInViewport();
  await expect(menu).toHaveCSS("position", "fixed");
});
