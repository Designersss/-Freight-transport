import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@freight/ui/components/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@freight/ui/components/empty";
import { Skeleton } from "@freight/ui/components/skeleton";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = { title: "MOVARO/Feedback/States" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ErrorState: Story = {
  render: (_, { globals }) => (
    <Alert variant="destructive" className="max-w-md">
      <AlertTitle>
        {globals.locale === "en" ? "Request failed" : "Ошибка запроса"}
      </AlertTitle>
      <AlertDescription>
        {globals.locale === "en" ? "Please try again." : "Попробуйте ещё раз."}
      </AlertDescription>
    </Alert>
  ),
};

export const EmptyState: Story = {
  render: (_, { globals }) => (
    <Empty className="max-w-lg border border-border">
      <EmptyHeader>
        <EmptyTitle>
          {globals.locale === "en" ? "No records" : "Нет записей"}
        </EmptyTitle>
        <EmptyDescription>
          {globals.locale === "en"
            ? "Records will appear here."
            : "Здесь будут отображаться записи."}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
};

export const Loading: Story = {
  render: (_, { globals }) => (
    <div className="flex max-w-md flex-col gap-3" aria-busy="true">
      <output className="sr-only">
        {globals.locale === "en" ? "Loading" : "Загрузка"}
      </output>
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  ),
};
