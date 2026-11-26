import { Button } from "@freight/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@freight/ui/components/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@freight/ui/components/field";
import { Input } from "@freight/ui/components/input";
import { Textarea } from "@freight/ui/components/textarea";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type FormEvent, useId, useState } from "react";
import { expect } from "storybook/test";

function FormExample({ locale }: { locale: "ru" | "en" }) {
  const ru = locale === "ru";
  const nameId = useId();
  const notesId = useId();
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const invalid = submitted && name.trim().length === 0;
  const valid = submitted && !invalid;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{ru ? "Пример формы" : "Form example"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={submit}>
          <FieldSet>
            <FieldLegend>
              {ru ? "Контактные данные" : "Contact details"}
            </FieldLegend>
            <FieldGroup>
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor={nameId}>{ru ? "Имя" : "Name"}</FieldLabel>
                <Input
                  id={nameId}
                  name="name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setSubmitted(false);
                  }}
                  required
                  aria-invalid={invalid}
                  aria-describedby={
                    invalid
                      ? `${nameId}-hint ${nameId}-error`
                      : `${nameId}-hint`
                  }
                />
                <FieldDescription id={`${nameId}-hint`}>
                  {ru ? "Обязательное поле" : "Required field"}
                </FieldDescription>
                {invalid && (
                  <FieldError id={`${nameId}-error`}>
                    {ru ? "Укажите имя" : "Enter a name"}
                  </FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor={notesId}>
                  {ru ? "Комментарий" : "Notes"}
                </FieldLabel>
                <Textarea id={notesId} name="notes" />
              </Field>
            </FieldGroup>
            <Button type="submit">{ru ? "Сохранить" : "Save"}</Button>
            {valid && (
              <output>{ru ? "Проверка пройдена" : "Validation passed"}</output>
            )}
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
}

const meta = {
  title: "MOVARO/Forms/Validation",
  component: FormExample,
  args: { locale: "ru" },
} satisfies Meta<typeof FormExample>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {
  render: (_, { globals }) => (
    <FormExample locale={globals.locale === "en" ? "en" : "ru"} />
  ),
};

export const RequiredField: Story = {
  ...Interactive,
  globals: { locale: "ru" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("Укажите имя");
    await userEvent.type(canvas.getByRole("textbox", { name: "Имя" }), "Анна");
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Проверка пройдена",
    );
  },
};
