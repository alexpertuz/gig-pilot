package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/gig-ops/dashboard/internal/model"
	"github.com/santifer/gig-ops/dashboard/internal/theme"
)

func tabIndexForFilter(t *testing.T, filter string) int {
	t.Helper()
	for i, tab := range pipelineTabs {
		if tab.filter == filter {
			return i
		}
	}
	t.Fatalf("expected pipeline tabs to include filter %q", filter)
	return -1
}

func TestWithReloadedDataPreservesStateAndSelection(t *testing.T) {
	initialLeads := []model.Lead{
		{
			Source:     "r/forhire",
			Gig:        "Build a React dashboard",
			Status:     "new",
			Score:      4.2,
			ReportPath: "reports/001-react.md",
		},
		{
			Source:     "remoteok",
			Gig:        "Backend API dev",
			Status:     "contacted",
			Score:      4.6,
			ReportPath: "reports/002-api.md",
		},
	}

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		initialLeads,
		model.PipelineMetrics{Total: len(initialLeads)},
		"..",
		120,
		40,
	)
	pm.sortMode = sortSource
	pm.activeTab = 0
	pm.viewMode = "flat"
	pm.applyFilterAndSort()
	pm.cursor = 1
	pm.reportCache["reports/002-api.md"] = reportSummary{tldr: "cached"}

	refreshedLeads := []model.Lead{
		initialLeads[0],
		initialLeads[1],
		{
			Source:     "r/jobbit",
			Gig:        "AI Engineer",
			Status:     "negotiating",
			Score:      4.8,
			ReportPath: "reports/003-ai.md",
		},
	}

	reloaded := pm.WithReloadedData(refreshedLeads, model.PipelineMetrics{Total: len(refreshedLeads)})

	if reloaded.sortMode != sortSource {
		t.Fatalf("expected sort mode %q, got %q", sortSource, reloaded.sortMode)
	}
	if reloaded.viewMode != "flat" {
		t.Fatalf("expected view mode to stay flat, got %q", reloaded.viewMode)
	}
	if got := len(reloaded.filtered); got != 3 {
		t.Fatalf("expected 3 filtered leads after refresh, got %d", got)
	}
	if lead, ok := reloaded.CurrentApp(); !ok || lead.ReportPath != "reports/002-api.md" {
		t.Fatalf("expected selection to stay on api lead, got %+v (ok=%v)", lead, ok)
	}
	if reloaded.reportCache["reports/002-api.md"].tldr != "cached" {
		t.Fatal("expected cached report summaries to survive refresh")
	}
}

func TestRenderAppLineIncludesDateAndSourceAndGig(t *testing.T) {
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		nil,
		model.PipelineMetrics{},
		"..",
		120,
		40,
	)

	line := pm.renderAppLine(model.Lead{
		Number: 42,
		Date:   "2026-04-13",
		Source: "r/forhire",
		Gig:    "Build a TUI dashboard",
		Status: "new",
		Score:  4.5,
	}, false)

	if !strings.Contains(line, "2026-04-13") {
		t.Fatalf("expected rendered line to include date, got %q", line)
	}
	if !strings.Contains(line, "#42") {
		t.Fatalf("expected rendered line to include tracker number, got %q", line)
	}
	if !strings.Contains(line, "r/forhire") {
		t.Fatalf("expected rendered line to include source, got %q", line)
	}
}

func TestSearchFiltersBySourceGigAndPoster(t *testing.T) {
	leads := []model.Lead{
		{Source: "r/forhire", Gig: "React developer needed", Status: "new", Score: 4.6, Poster: "u/techcorp"},
		{Source: "remoteok", Gig: "Backend API engineer", Status: "contacted", Score: 4.8, Poster: "AcmeCorp"},
		{Source: "r/jobbit", Gig: "Build AI chatbot", Status: "new", Score: 4.2, Poster: "u/startup"},
		{Source: "workingnomads", Gig: "Platform engineer", Status: "replied", Score: 3.9, Poster: "GlobalTech"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), leads, model.PipelineMetrics{Total: len(leads)}, "..", 120, 40)
	pm.activeTab = tabIndexForFilter(t, filterAll)

	pm.searchQuery = "forhire"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Source != "r/forhire" {
		t.Fatalf("expected 1 match for 'forhire', got %+v", pm.filtered)
	}

	pm.searchQuery = "ai chatbot"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Source != "r/jobbit" {
		t.Fatalf("expected 1 match for 'ai chatbot', got %+v", pm.filtered)
	}

	pm.searchQuery = "acmecorp"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Poster != "AcmeCorp" {
		t.Fatalf("expected 1 match for poster 'acmecorp', got %+v", pm.filtered)
	}

	pm.searchQuery = ""
	pm.applyFilterAndSort()
	if len(pm.filtered) != len(leads) {
		t.Fatalf("expected empty query to restore all rows, got %d/%d", len(pm.filtered), len(leads))
	}
}

func TestSearchComposesWithActiveTab(t *testing.T) {
	leads := []model.Lead{
		{Source: "r/forhire", Gig: "Backend dev", Status: "new", Score: 4.6},
		{Source: "r/forhire", Gig: "Frontend dev", Status: "contacted", Score: 4.5},
		{Source: "remoteok", Gig: "AI engineer", Status: "contacted", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), leads, model.PipelineMetrics{Total: len(leads)}, "..", 120, 40)
	pm.activeTab = tabIndexForFilter(t, filterContacted)
	pm.searchQuery = "forhire"
	pm.applyFilterAndSort()

	if len(pm.filtered) != 1 || pm.filtered[0].Gig != "Frontend dev" {
		t.Fatalf("expected contacted+forhire to leave only Frontend dev, got %+v", pm.filtered)
	}
}

func TestSearchIsCaseInsensitive(t *testing.T) {
	leads := []model.Lead{
		{Source: "RemoteOK", Gig: "AI Engineer", Status: "new", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), leads, model.PipelineMetrics{Total: len(leads)}, "..", 120, 40)
	for _, q := range []string{"remoteok", "REMOTEOK", "ReMoTeOk"} {
		pm.searchQuery = q
		pm.applyFilterAndSort()
		if len(pm.filtered) != 1 {
			t.Fatalf("expected case-insensitive match for %q, got %d rows", q, len(pm.filtered))
		}
	}
}

func TestSearchEnterCommitsAndEscClearsCommittedQuery(t *testing.T) {
	leads := []model.Lead{
		{Source: "r/forhire", Gig: "React dev", Status: "new", Score: 4.6},
		{Source: "remoteok", Gig: "AI engineer", Status: "new", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), leads, model.PipelineMetrics{Total: len(leads)}, "..", 120, 40)

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	if !pm.searchInput {
		t.Fatal("expected `/` to open search input")
	}
	for _, r := range "forhire" {
		pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	if pm.searchQuery != "forhire" {
		t.Fatalf("expected query to live-update to 'forhire', got %q", pm.searchQuery)
	}
	if len(pm.filtered) != 1 || pm.filtered[0].Source != "r/forhire" {
		t.Fatalf("expected live filter to leave only r/forhire, got %+v", pm.filtered)
	}

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if pm.searchInput {
		t.Fatal("expected Enter to close input")
	}
	if pm.searchQuery != "forhire" {
		t.Fatalf("expected Enter to keep committed query, got %q", pm.searchQuery)
	}

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if pm.searchQuery != "" {
		t.Fatalf("expected Esc to clear committed query, got %q", pm.searchQuery)
	}
	if len(pm.filtered) != len(leads) {
		t.Fatalf("expected Esc to restore full list, got %d/%d", len(pm.filtered), len(leads))
	}
}

func TestSearchEscInInputCancelsAndClears(t *testing.T) {
	leads := []model.Lead{
		{Source: "r/forhire", Gig: "React dev", Status: "new", Score: 4.6},
		{Source: "r/jobbit", Gig: "Backend", Status: "new", Score: 4.0},
		{Source: "remoteok", Gig: "AI engineer", Status: "new", Score: 4.8},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), leads, model.PipelineMetrics{Total: len(leads)}, "..", 120, 40)
	pm.searchInput = true
	pm.searchQuery = "forhire"
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 {
		t.Fatalf("setup expected 1 row matching 'forhire', got %d", len(pm.filtered))
	}

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if pm.searchInput {
		t.Fatal("expected Esc in input mode to close input")
	}
	if pm.searchQuery != "" {
		t.Fatalf("expected Esc in input mode to clear in-progress query, got %q", pm.searchQuery)
	}
	if len(pm.filtered) != len(leads) {
		t.Fatalf("expected Esc to re-expand filtered list to %d rows, got %d", len(leads), len(pm.filtered))
	}
}

func TestSearchResetsCursorOnQueryChange(t *testing.T) {
	leads := []model.Lead{
		{Source: "r/forhire", Gig: "React dev", Status: "new", Score: 4.0},
		{Source: "r/jobbit", Gig: "Backend", Status: "new", Score: 4.1},
		{Source: "remoteok", Gig: "AI engineer", Status: "new", Score: 4.2},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), leads, model.PipelineMetrics{Total: len(leads)}, "..", 120, 40)
	pm.cursor = 2

	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})

	if pm.cursor != 0 {
		t.Fatalf("expected cursor to reset to 0 on query change, got %d", pm.cursor)
	}
	if pm.scrollOffset != 0 {
		t.Fatalf("expected scrollOffset to reset to 0, got %d", pm.scrollOffset)
	}
}

func TestSearchStatePreservedAcrossReload(t *testing.T) {
	initial := []model.Lead{
		{Source: "r/forhire", Gig: "React dev", Status: "new", Score: 4.6},
		{Source: "remoteok", Gig: "AI engineer", Status: "contacted", Score: 4.0},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), initial, model.PipelineMetrics{Total: len(initial)}, "..", 120, 40)
	pm.searchQuery = "forhire"
	pm.applyFilterAndSort()

	refreshed := append([]model.Lead{}, initial...)
	refreshed = append(refreshed, model.Lead{Source: "r/jobbit", Gig: "Platform dev", Status: "replied", Score: 4.3})

	reloaded := pm.WithReloadedData(refreshed, model.PipelineMetrics{Total: len(refreshed)})

	if reloaded.searchQuery != "forhire" {
		t.Fatalf("expected refresh to preserve search query, got %q", reloaded.searchQuery)
	}
	if len(reloaded.filtered) != 1 || reloaded.filtered[0].Source != "r/forhire" {
		t.Fatalf("expected refresh+search to keep filter applied, got %+v", reloaded.filtered)
	}
}

func TestLostAndDroppedTabsFilterCorrectly(t *testing.T) {
	leads := []model.Lead{
		{Source: "r/forhire", Gig: "React dev", Status: "lost", Score: 3.4, ReportPath: "reports/001.md"},
		{Source: "remoteok", Gig: "AI engineer", Status: "dropped", Score: 2.1, ReportPath: "reports/002.md"},
		{Source: "r/jobbit", Gig: "Backend dev", Status: "contacted", Score: 4.6, ReportPath: "reports/003.md"},
	}

	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		leads,
		model.PipelineMetrics{Total: len(leads)},
		"..",
		120,
		40,
	)

	pm.activeTab = tabIndexForFilter(t, filterLost)
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Status != "lost" {
		t.Fatalf("expected lost tab to isolate lost rows, got %+v", pm.filtered)
	}

	pm.activeTab = tabIndexForFilter(t, filterDropped)
	pm.applyFilterAndSort()
	if len(pm.filtered) != 1 || pm.filtered[0].Status != "dropped" {
		t.Fatalf("expected dropped tab to isolate dropped rows, got %+v", pm.filtered)
	}
}

func TestEscWithoutQueryIsNoOp(t *testing.T) {
	leads := []model.Lead{
		{Source: "r/forhire", Gig: "React dev", Status: "new", Score: 4.6},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), leads, model.PipelineMetrics{Total: len(leads)}, "..", 120, 40)
	if pm.searchQuery != "" {
		t.Fatalf("setup expected empty search query, got %q", pm.searchQuery)
	}

	pm, cmd := pm.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if cmd != nil {
		if msg := cmd(); msg != nil {
			if _, ok := msg.(PipelineClosedMsg); ok {
				t.Fatalf("expected Esc with no query to be a no-op, got PipelineClosedMsg")
			}
			t.Fatalf("expected Esc with no query to return nil cmd, got %T", msg)
		}
	}
	if pm.searchInput {
		t.Fatal("Esc with no query should not toggle searchInput")
	}
}

func TestSearchTypingDoesNotLoadReports(t *testing.T) {
	leads := []model.Lead{
		{Source: "r/forhire", Gig: "React dev", Status: "new", Score: 4.6, ReportPath: "reports/001.md"},
		{Source: "remoteok", Gig: "AI engineer", Status: "new", Score: 4.8, ReportPath: "reports/002.md"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), leads, model.PipelineMetrics{Total: len(leads)}, "..", 120, 40)
	pm, _ = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	if !pm.searchInput {
		t.Fatal("expected `/` to open search input")
	}

	for _, r := range "forhire" {
		var cmd tea.Cmd
		pm, cmd = pm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		if cmd != nil {
			if msg := cmd(); msg != nil {
				if _, ok := msg.(PipelineLoadReportMsg); ok {
					t.Fatalf("typing rune %q should not emit PipelineLoadReportMsg", string(r))
				}
			}
		}
	}

	pm, cmd := pm.Update(tea.KeyMsg{Type: tea.KeyBackspace})
	if cmd != nil {
		if msg := cmd(); msg != nil {
			if _, ok := msg.(PipelineLoadReportMsg); ok {
				t.Fatal("Backspace during search input should not emit PipelineLoadReportMsg")
			}
		}
	}

	pm, cmd = pm.Update(tea.KeyMsg{Type: tea.KeyCtrlU})
	if cmd != nil {
		if msg := cmd(); msg != nil {
			if _, ok := msg.(PipelineLoadReportMsg); ok {
				t.Fatal("Ctrl+U during search input should not emit PipelineLoadReportMsg")
			}
		}
	}
}

func previewModelWith(t *testing.T, lead model.Lead) PipelineModel {
	t.Helper()
	pm := NewPipelineModel(
		theme.NewTheme("catppuccin-mocha"),
		[]model.Lead{lead},
		model.PipelineMetrics{Total: 1},
		"..",
		120,
		40,
	)
	pm.applyFilterAndSort()
	pm.cursor = 0
	return pm
}

func TestPreviewShowsPosterChannelRate(t *testing.T) {
	lead := model.Lead{
		Source:  "r/forhire",
		Gig:     "Build a React app",
		Status:  "contacted",
		Score:   4.2,
		Poster:  "u/techcorp",
		Channel: "dm",
		Rate:    "$75/hr",
	}
	pm := previewModelWith(t, lead)

	preview := pm.renderPreview()

	if !strings.Contains(preview, "u/techcorp") {
		t.Fatalf("expected preview to show poster, got %q", preview)
	}
	if !strings.Contains(preview, "dm") {
		t.Fatalf("expected preview to show channel, got %q", preview)
	}
	if !strings.Contains(preview, "$75/hr") {
		t.Fatalf("expected preview to show rate, got %q", preview)
	}
}

func TestPreviewShowsReportCacheWhenAvailable(t *testing.T) {
	lead := model.Lead{
		Source:     "remoteok",
		Gig:        "AI platform engineer",
		Status:     "negotiating",
		Score:      4.8,
		ReportPath: "reports/001.md",
	}
	pm := previewModelWith(t, lead)
	pm.reportCache[lead.ReportPath] = reportSummary{
		archetype: "Contractor",
		tldr:      "solid scope, fair budget",
	}

	preview := pm.renderPreview()

	if !strings.Contains(preview, "Contractor") {
		t.Fatalf("expected preview to show archetype, got %q", preview)
	}
	if !strings.Contains(preview, "solid scope, fair budget") {
		t.Fatalf("expected preview to show TL;DR, got %q", preview)
	}
}

func TestPreviewOutcomeOmittedForActiveLeads(t *testing.T) {
	lead := model.Lead{
		Source:     "r/forhire",
		Gig:        "React dev",
		Status:     "replied",
		Score:      4.5,
		ReportPath: "reports/002.md",
	}
	pm := previewModelWith(t, lead)
	pm.reportCache[lead.ReportPath] = reportSummary{tldr: "strong fit"}

	preview := pm.renderPreview()

	if strings.Contains(preview, "Outcome:") {
		t.Fatalf("expected no outcome line for an active lead, got %q", preview)
	}
}
