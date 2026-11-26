import type { Preview } from "@storybook/react-vite";
import { type ReactNode, useLayoutEffect } from "react";
import "./preview.css";

function PreviewEnvironment({
  theme,
  locale,
  children,
}: {
  theme: "dark" | "light";
  locale: "ru" | "en";
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute("data-theme");
    const previousLanguage = root.lang;
    root.setAttribute("data-theme", theme);
    root.lang = locale;
    return () => {
      if (previousTheme === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previousTheme);
      root.lang = previousLanguage;
    };
  }, [theme, locale]);

  return <div className="min-w-0 text-foreground">{children}</div>;
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "MOVARO color theme",
      toolbar: { title: "Theme", icon: "circlehollow", items: ["dark", "light"], dynamicTitle: true },
    },
    locale: {
      description: "MOVARO language",
      toolbar: { title: "Language", icon: "globe", items: ["ru", "en"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "dark", locale: "ru" },
  parameters: {
    layout: "padded",
    backgrounds: { disable: true },
    a11y: { test: "error" },
  },
  decorators: [
    (Story, context) => (
      <PreviewEnvironment
        theme={context.globals.theme === "light" ? "light" : "dark"}
        locale={context.globals.locale === "en" ? "en" : "ru"}
      >
        <Story />
      </PreviewEnvironment>
    ),
  ],
};

export default preview;
