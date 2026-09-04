/**
 * Curated Filament v5 guidance. Kept local (not fetched) so it is instant,
 * offline-safe, and stable — upstream has no equivalent machine-readable page.
 */

export const BEST_PRACTICES = {
  architecture: `## Architecture
- Use separated Schema classes (CustomerForm.php) and Table classes (CustomersTable.php) — v5 generates these by default. Keep Resource classes lean.
- Move complex mutation logic into Model Observers or Service classes, not into form/table definitions.
- Use \`->components()\` for form schemas (replaces v4's \`->schema()\` on forms).
- Use \`->recordActions()\` for row-level table actions and \`->toolbarActions()\` for bulk/header actions.
- Use \`->schema()\` for action modal form content (NOT \`->form()\`).
- Prefer simple (modal) resources (\`--simple\`) for CRUD-only models that don't need separate pages.`,

  actions: `## Actions
- Prefer built-in Actions (CreateAction, EditAction, DeleteAction, ViewAction) over custom Livewire components.
- Use Action modals (\`->schema([...])\`) and slide-overs instead of creating custom pages or Blade views.
- Use the \`Heroicon\` enum for icons: \`->icon(Heroicon::PencilSquare)\` instead of string \`'heroicon-o-pencil-square'\`.
- Use \`->requiresConfirmation()\` for destructive actions.
- Use \`->fillForm(fn ($record) => $record)\` to pre-fill modal forms.`,

  database: `## Database & Queries
- Use \`modifyQueryUsing()\` on tables to eager-load relationships and prevent N+1.
- Use \`->searchable()\` and \`->sortable()\` only on indexed database columns.
- Rely on \`->relationship()\` for saving related data from forms instead of manual \`mutateFormDataBeforeSave\`.
- Override \`getEloquentQuery()\` for resource-wide query constraints (scopes, soft-deletes, tenancy).`,

  forms: `## Forms
- Use the \`Hidden\` component to pass contextual data instead of relying on global state.
- Use \`Operation::Create\` / \`Operation::Edit\` enum with \`->hiddenOn()\` / \`->visibleOn()\` for conditional fields.
- Use \`->relationship()\` on Select and other components for automatic relationship management.
- Prefer Filament's built-in validation rules over custom rule objects where possible.`,

  authorization: `## Authorization
- Rely strictly on Laravel Policies. Filament auto-maps: viewAny, create, update, view, delete, forceDelete, restore, reorder.
- Do NOT write manual auth checks in Resources — use Policy methods.
- Use \`$shouldSkipAuthorization = true\` only for development.
- Use \`->authorizeIndividualRecords()\` on bulk actions when per-record auth is needed.`,

  ui: `## UI & Styling
- Use Filament's theme config (Tailwind) and \`->extraAttributes()\` over raw CSS or custom Blade views.
- Use \`SubNavigationPosition::Top\` for tabbed navigation within resources.
- Use Section, Flex, Grid layout components for form organization.
- Use \`->grow(false)\` to prevent components from expanding.`,

  antiPatterns: `## Anti-Patterns to Avoid
- DON'T use \`->schema()\` on form definitions — use \`->components()\` (v5 change).
- DON'T use \`->actions()\` on tables — use \`->recordActions()\` or \`->toolbarActions()\` (v5 change).
- DON'T use string icon names — use the \`Heroicon\` enum.
- DON'T create custom Livewire components for CRUD — use Resources.
- DON'T put heavy logic in Resource classes — use Services/Observers.
- DON'T hardcode routes — use \`ResourceClass::getUrl()\`.
- DON'T define forms/tables inline in Resource if they're large — use the separated Schema/Table classes.`,
};

export const ALL_TOPICS = Object.keys(BEST_PRACTICES);

export function renderBestPractices(topic) {
  if (topic) {
    const key = ALL_TOPICS.find((t) => t.toLowerCase() === String(topic).toLowerCase());
    if (key) return `# Filament v5 Best Practices — ${key}\n\n${BEST_PRACTICES[key]}`;
    return (
      `Unknown topic "${topic}". Available topics: ${ALL_TOPICS.join(", ")}.\n\n` +
      `# Filament v5 Best Practices\n\n${Object.values(BEST_PRACTICES).join("\n\n")}`
    );
  }
  return `# Filament v5 Best Practices\n\n${Object.values(BEST_PRACTICES).join("\n\n")}`;
}
