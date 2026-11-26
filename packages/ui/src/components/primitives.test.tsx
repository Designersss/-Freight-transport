import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Badge } from "./badge";
import { Empty, EmptyDescription, EmptyTitle } from "./empty";
import { Field, FieldDescription, FieldError, FieldLabel } from "./field";
import { Input } from "./input";
import { Skeleton } from "./skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "./table";
import { Textarea } from "./textarea";

describe("shared UI primitives", () => {
  it("preserves native form semantics, accessible labels and error references", () => {
    const markup = renderToStaticMarkup(
      <Field data-invalid={true}>
        <FieldLabel htmlFor="example">Example</FieldLabel>
        <Input id="example" name="example" required aria-invalid={true} aria-describedby="hint error" />
        <FieldDescription id="hint">Hint</FieldDescription>
        <FieldError id="error" errors={[{ message: "Required" }, { message: "Required" }]} />
        <Textarea aria-label="Notes" name="notes" disabled />
      </Field>,
    );
    expect(markup).toContain('for="example"');
    expect(markup).toContain('id="example"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="hint error"');
    expect(markup).toContain('id="error"');
    expect(markup).toContain('role="alert"');
    expect(markup.match(/Required/g)).toHaveLength(1);
    expect(markup).toContain('disabled=""');
  });

  it("renders distinct error messages and omits the error slot when empty", () => {
    expect(renderToStaticMarkup(<FieldError errors={[]} />)).toBe("");
    const markup = renderToStaticMarkup(
      <FieldError errors={[undefined, { message: "First" }, { message: "Second" }]} />,
    );
    expect(markup).toContain("<ul");
    expect(markup).toContain("First");
    expect(markup).toContain("Second");
  });

  it("preserves table semantics and provides an overflow container", () => {
    const markup = renderToStaticMarkup(
      <Table>
        <TableCaption>Example table</TableCaption>
        <TableHeader>
          <TableRow><TableHead scope="col">Name</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          <TableRow><TableCell>Example</TableCell></TableRow>
        </TableBody>
      </Table>,
    );
    expect(markup).toContain('data-slot="table-container"');
    expect(markup).toContain("<table");
    expect(markup).toContain("<caption");
    expect(markup).toContain('scope="col"');
    expect(markup).toContain("<tbody");
    expect(markup).toContain("<td");
  });

  it("renders alert, empty and decorative loading primitives", () => {
    const markup = renderToStaticMarkup(
      <section>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Try again</AlertDescription>
        </Alert>
        <Empty><EmptyTitle>No records</EmptyTitle><EmptyDescription>Nothing here</EmptyDescription></Empty>
        <Skeleton className="h-4 w-full" />
        <Badge variant="outline">Status</Badge>
      </section>,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-slot="empty"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-variant="outline"');
  });
});
