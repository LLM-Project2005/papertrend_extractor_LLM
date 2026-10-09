import type { DocsCategoryBase } from "./types";
import { dashboardPage } from "./explore-dashboard";
import { chatPage, deepResearchPage } from "./explore-chat";

export const exploreCategory: DocsCategoryBase = {
  id: "explore",
  label: "Explore and ask",
  description: "Read a repository as a whole: the dashboard's charts, Chat's cited answers at every thinking effort.",
  pages: [dashboardPage, chatPage, deepResearchPage],
};
