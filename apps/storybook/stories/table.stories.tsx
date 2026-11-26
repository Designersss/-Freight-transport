import { Badge } from "@freight/ui/components/badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@freight/ui/components/table";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = { title: "MOVARO/Data/Table", component: Table } satisfies Meta<typeof Table>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  render: (_, { globals }) => {
    const ru = globals.locale !== "en";
    const rows = [
      { id: "A", name: ru ? "Пример A" : "Example A", ready: true },
      { id: "B", name: ru ? "Пример B" : "Example B", ready: false },
    ];
    return (
      <div className="max-w-3xl rounded-xl border border-border bg-card">
        <Table>
          <TableCaption>{ru ? "Тестовые данные Storybook" : "Storybook fixtures"}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">ID</TableHead>
              <TableHead scope="col">{ru ? "Название" : "Name"}</TableHead>
              <TableHead scope="col">{ru ? "Статус" : "Status"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.id}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell><Badge variant={row.ready ? "default" : "secondary"}>{row.ready ? (ru ? "Готово" : "Ready") : (ru ? "Ожидает" : "Pending")}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  },
};
