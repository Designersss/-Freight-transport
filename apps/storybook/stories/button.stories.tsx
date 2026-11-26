import { Button } from "@freight/ui/components/button";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";

const meta = {
  title: "MOVARO/Controls/Button",
  component: Button,
  args: { onClick: fn(), children: "Continue" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args, { globals }) => (
    <Button {...args}>{globals.locale === "en" ? "Continue" : "Продолжить"}</Button>
  ),
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button"));
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const Variants: Story = {
  render: (_, { globals }) => {
    const ru = globals.locale !== "en";
    return (
      <div className="flex flex-wrap gap-3">
        <Button>{ru ? "Основная" : "Primary"}</Button>
        <Button variant="secondary">{ru ? "Вторичная" : "Secondary"}</Button>
        <Button variant="outline">{ru ? "Контурная" : "Outline"}</Button>
        <Button variant="ghost">{ru ? "Прозрачная" : "Ghost"}</Button>
        <Button variant="destructive">{ru ? "Удалить" : "Delete"}</Button>
        <Button disabled>{ru ? "Недоступно" : "Disabled"}</Button>
      </div>
    );
  },
};

export const Sizes: Story = {
  render: (_, { globals }) => (
    <div className="flex flex-wrap items-center gap-3">
      {(["xs", "sm", "default", "lg"] as const).map((size) => (
        <Button key={size} size={size}>{globals.locale === "en" ? "Button" : "Кнопка"} · {size}</Button>
      ))}
    </div>
  ),
};
