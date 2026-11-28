import { type Locale, messages } from "@freight/i18n";
import { DatePicker, Field, FieldLabel } from "@freight/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

function DatePickerExample({
  locale,
  disabled = false,
}: {
  locale: Locale;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <Field className="max-w-72">
      <FieldLabel htmlFor="example-date">
        {messages[locale].auth.birthDate}
      </FieldLabel>
      <DatePicker
        id="example-date"
        locale={locale}
        value={value}
        onChange={setValue}
        min="0001-01-01"
        max="2026-11-27"
        disabled={disabled}
      />
    </Field>
  );
}

const meta = {
  title: "Forms/DatePicker",
  component: DatePickerExample,
  args: { locale: "ru" },
  render: (args, context) => (
    <DatePickerExample
      key={context.globals.locale}
      {...args}
      locale={context.globals.locale === "en" ? "en" : "ru"}
    />
  ),
} satisfies Meta<typeof DatePickerExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
