import type { DocsCategoryBase } from "./types";
import { dashboardPage } from "./explore-dashboard";
import { chatPage, deepResearchPage } from "./explore-chat";
import { tablePage } from "./explore-table";

export const exploreCategory: DocsCategoryBase = {
  id: "explore",
  label: "Explore and ask",
  description: "Read a repository as a whole: the dashboard's charts, Chat's cited answers at every thinking effort, and tables of the papers against your own columns.",
  pages: [dashboardPage, chatPage, deepResearchPage, tablePage],
};
