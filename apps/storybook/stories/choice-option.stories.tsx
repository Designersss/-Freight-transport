import { ChoiceOption } from "@freight/ui/components/role-option";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";

const meta = {
  title: "MOVARO/Controls/ChoiceOption",
  component: ChoiceOption,
  args: {
    choice: "email",
    title: "Email address",
    description: "Register by verifying your email",
    disabled: false,
    onSelect: fn(),
  },
} satisfies Meta<typeof ChoiceOption>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RegistrationMethod: Story = {
  render: (args, { globals }) => (
    <ChoiceOption
      {...args}
      title={globals.locale === "en" ? "Email address" : "Электронная почта"}
      description={
        globals.locale === "en"
          ? "Register by verifying your email"
          : "Регистрация с подтверждением email"
      }
    />
  ),
  play: async ({ canvas, userEvent, args }) => {
    const button = canvas.getByRole("button", {
      name: /^(Email address Register by verifying your email|Электронная почта Регистрация с подтверждением email)$/,
    });
    await userEvent.click(button);
    await expect(args.onSelect).toHaveBeenCalledTimes(1);
  },
};

export const Unavailable: Story = {
  args: {
    choice: "telegram",
    title: "Register with Telegram",
    description: "Telegram sign-in is currently unavailable.",
    disabled: true,
  },
  render: (args, { globals }) => (
    <ChoiceOption
      {...args}
      title={
        globals.locale === "en"
          ? "Register with Telegram"
          : "Регистрация через Telegram"
      }
      description={
        globals.locale === "en"
          ? "Telegram sign-in is currently unavailable."
          : "Вход через Telegram сейчас недоступен."
      }
    />
  ),
};
