package screens

import (
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/gig-ops/dashboard/internal/data"
	"github.com/santifer/gig-ops/dashboard/internal/model"
	"github.com/santifer/gig-ops/dashboard/internal/theme"
)

// PipelineClosedMsg is emitted when the pipeline screen is dismissed.
type PipelineClosedMsg struct{}

// PipelineOpenReportMsg is emitted when a report should be opened in FileViewer.
type PipelineOpenReportMsg struct {
	Path   string
	Title  string
	JobURL string
}

// PipelineOpenURLMsg is emitted when a job URL should be opened in browser.
type PipelineOpenURLMsg struct {
	URL string
}

// PipelineLoadReportMsg requests lazy loading of a report summary.
type PipelineLoadReportMsg struct {
	GigOpsPath string
	ReportPath string
}

// PipelineUpdateStatusMsg requests a status update for a lead.
type PipelineUpdateStatusMsg struct {
	GigOpsPath string
	Lead       model.Lead
	NewStatus  string
}

// PipelineRefreshMsg requests a full tracker reload from disk.
type PipelineRefreshMsg struct{}

// PipelineOpenProgressMsg is emitted when the progress screen should open.
type PipelineOpenProgressMsg struct{}

type reportSummary struct {
	archetype string
	tldr      string
}

// Sort modes
const (
	sortScore   = "score"
	sortDate    = "date"
	sortSource  = "source"
	sortStatus  = "status"
	sortChannel = "channel"
	sortRate    = "rate"
	sortFollowup = "followup"
)

// Filter modes
const (
	filterAll         = "all"
	filterNew         = "new"
	filterContacted   = "contacted"
	filterNegotiating = "negotiating"
	filterWon         = "won"
	filterLost        = "lost"
	filterDropped     = "dropped"
	filterTop         = "top"
)

type pipelineTab struct {
	filter string
	label  string
}

var pipelineTabs = []pipelineTab{
	{filterAll, "ALL"},
	{filterNew, "NEW"},
	{filterContacted, "CONTACTED"},
	{filterNegotiating, "NEGOTIATING"},
	{filterWon, "WON"},
	{filterTop, "TOP ≥4"},
	{filterLost, "LOST"},
	{filterDropped, "DROPPED"},
}

var sortCycle = []string{sortScore, sortDate, sortSource, sortStatus, sortChannel, sortRate, sortFollowup}

// ColumnID identifies an optional table column in the pipeline view.
type ColumnID int

const (
	// Optional columns — user-toggleable via the column picker (C key).
	ColDate      ColumnID = iota // DATE first seen
	ColChannel                   // CHANNEL dm/email/comment/apply
	ColRate                      // RATE hourly/project
	ColHasReport                 // RPT: ✓/—
	ColFollowup                  // FOLLOWUP next follow-up date
)

// colDef describes one optional column for the picker UI.
type colDef struct {
	id          ColumnID
	header      string
	hint        string
	width       int
	onByDefault bool
}

var optionalCols = []colDef{
	{ColDate, "DATE", "", 10, true},
	{ColChannel, "CHANNEL", "", 12, true},
	{ColRate, "RATE", "", 14, true},
	{ColHasReport, "RPT", "✓/—", 4, false},
	{ColFollowup, "FOLLOWUP", "", 10, false},
}

var statusOptions = []string{"new", "contacted", "replied", "negotiating", "won", "lost", "dropped"}

// statusGroupOrder defines display order for grouped view.
var statusGroupOrder = []string{"negotiating", "won", "replied", "contacted", "new", "lost", "dropped"}

// PipelineModel implements the career pipeline dashboard screen.
type PipelineModel struct {
	apps          []model.Lead
	filtered      []model.Lead
	metrics       model.PipelineMetrics
	cursor        int
	scrollOffset  int
	sortMode      string
	activeTab     int
	viewMode      string // "grouped" or "flat"
	width, height int
	theme         theme.Theme
	gigOpsPath string
	reportCache   map[string]reportSummary
	// Status picker sub-state
	statusPicker bool
	statusCursor int
	// Search sub-state — narrows the active tab by substring on company/role/notes.
	searchInput bool   // true while the user is typing the query
	searchQuery string // committed (or in-progress) lowercased query
	// Column picker sub-state — opened with C, closed with esc.
	colPicker    bool
	colPickerIdx int
	visibleCols  map[ColumnID]bool
}

// NewPipelineModel creates a new pipeline screen.
func NewPipelineModel(t theme.Theme, apps []model.Lead, metrics model.PipelineMetrics, gigOpsPath string, width, height int) PipelineModel {
	visible := make(map[ColumnID]bool)
	for _, col := range optionalCols {
		visible[col.id] = col.onByDefault
	}
	m := PipelineModel{
		apps:          apps,
		metrics:       metrics,
		sortMode:      sortScore,
		activeTab:     0,
		viewMode:      "grouped",
		width:         width,
		height:        height,
		theme:         t,
		gigOpsPath: gigOpsPath,
		reportCache:   make(map[string]reportSummary),
		visibleCols:   visible,
	}
	m.applyFilterAndSort()
	return m
}

// Init implements tea.Model.
func (m PipelineModel) Init() tea.Cmd {
	return nil
}

// Resize updates dimensions.
func (m *PipelineModel) Resize(width, height int) {
	m.width = width
	m.height = height
}

// Width returns the current width.
func (m PipelineModel) Width() int { return m.width }

// Height returns the current height.
func (m PipelineModel) Height() int { return m.height }

// CopyReportCache copies the report cache from another pipeline model.
func (m *PipelineModel) CopyReportCache(other *PipelineModel) {
	for k, v := range other.reportCache {
		m.reportCache[k] = v
	}
}

// EnrichReport caches report summary data for preview.
func (m *PipelineModel) EnrichReport(reportPath, archetype, tldr string) {
	m.reportCache[reportPath] = reportSummary{
		archetype: archetype,
		tldr:      tldr,
	}
}

// WithReloadedData rebuilds the pipeline with fresh tracker data while preserving
// the current UI state so manual refresh feels seamless.
func (m PipelineModel) WithReloadedData(apps []model.Lead, metrics model.PipelineMetrics) PipelineModel {
	selectedReportPath := ""
	selectedSource := ""
	selectedGig := ""
	if app, ok := m.CurrentApp(); ok {
		selectedReportPath = app.ReportPath
		selectedSource = app.Source
		selectedGig = app.Gig
	}

	reloaded := NewPipelineModel(m.theme, apps, metrics, m.gigOpsPath, m.width, m.height)
	reloaded.sortMode = m.sortMode
	reloaded.activeTab = m.activeTab
	reloaded.viewMode = m.viewMode
	// Preserve search state across refresh — otherwise pressing `r` silently drops a
	// committed query and the user loses their place mid-investigation.
	reloaded.searchQuery = m.searchQuery
	reloaded.searchInput = m.searchInput
	// Preserve user's column visibility choices across refresh.
	reloaded.visibleCols = m.visibleCols
	reloaded.applyFilterAndSort()
	reloaded.CopyReportCache(&m)

	for i, app := range reloaded.filtered {
		if selectedReportPath != "" && app.ReportPath == selectedReportPath {
			reloaded.cursor = i
			reloaded.adjustScroll()
			return reloaded
		}
		if selectedReportPath == "" && app.Source == selectedSource && app.Gig == selectedGig {
			reloaded.cursor = i
			reloaded.adjustScroll()
			return reloaded
		}
	}

	if len(reloaded.filtered) == 0 {
		reloaded.cursor = 0
		reloaded.scrollOffset = 0
		return reloaded
	}

	if m.cursor >= len(reloaded.filtered) {
		reloaded.cursor = len(reloaded.filtered) - 1
	} else if m.cursor > 0 {
		reloaded.cursor = m.cursor
	}
	reloaded.adjustScroll()
	return reloaded
}

// CurrentApp returns the currently selected application, if any.
func (m PipelineModel) CurrentApp() (model.Lead, bool) {
	if m.cursor < 0 || m.cursor >= len(m.filtered) {
		return model.Lead{}, false
	}
	return m.filtered[m.cursor], true
}

// Update handles input for the pipeline screen.
func (m PipelineModel) Update(msg tea.Msg) (PipelineModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.colPicker {
			return m.handleColPicker(msg)
		}
		if m.statusPicker {
			return m.handleStatusPicker(msg)
		}
		if m.searchInput {
			return m.handleSearchInput(msg)
		}
		return m.handleKey(msg)
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	}
	return m, nil
}

func (m PipelineModel) handleKey(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc":
		// While a search is committed, Esc clears the search (matches vim's `:nohl`
		// ergonomics). With no query, Esc is a no-op — q is the only quit key, which
		// keeps the help bar honest and avoids accidental exits.
		if m.searchQuery != "" {
			m.searchQuery = ""
			m.applyFilterAndSort()
			m.cursor = 0
			m.scrollOffset = 0
			return m, m.loadCurrentReport()
		}
		return m, nil

	case "q":
		return m, func() tea.Msg { return PipelineClosedMsg{} }

	case "/":
		// Open search input. Pre-fill with the current query so refining is one keystroke away.
		m.searchInput = true
		return m, nil

	case "down", "j":
		if len(m.filtered) > 0 {
			m.cursor++
			if m.cursor >= len(m.filtered) {
				m.cursor = len(m.filtered) - 1
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "up", "k":
		if len(m.filtered) > 0 {
			m.cursor--
			if m.cursor < 0 {
				m.cursor = 0
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "s":
		// Cycle sort mode
		for i, s := range sortCycle {
			if s == m.sortMode {
				m.sortMode = sortCycle[(i+1)%len(sortCycle)]
				break
			}
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "f", "right", "l":
		m.activeTab++
		if m.activeTab >= len(pipelineTabs) {
			m.activeTab = 0
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "left", "h":
		m.activeTab--
		if m.activeTab < 0 {
			m.activeTab = len(pipelineTabs) - 1
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "v":
		if m.viewMode == "grouped" {
			m.viewMode = "flat"
		} else {
			m.viewMode = "grouped"
		}

	case "enter":
		if app, ok := m.CurrentApp(); ok && app.ReportPath != "" {
			fullPath := filepath.Join(m.gigOpsPath, app.ReportPath)
			title := fmt.Sprintf("%s — %s", app.Source, app.Gig)
			jobURL := app.JobURL
			return m, func() tea.Msg {
				return PipelineOpenReportMsg{Path: fullPath, Title: title, JobURL: jobURL}
			}
		}

	case "o":
		if app, ok := m.CurrentApp(); ok && app.JobURL != "" {
			return m, func() tea.Msg {
				return PipelineOpenURLMsg{URL: app.JobURL}
			}
		}

	case "p":
		return m, func() tea.Msg { return PipelineOpenProgressMsg{} }

	case "r":
		return m, func() tea.Msg { return PipelineRefreshMsg{} }

	case "C":
		m.colPicker = true
		m.colPickerIdx = 0
		return m, nil

	case "c":
		if len(m.filtered) > 0 {
			m.statusPicker = true
			m.statusCursor = 0
		}

	case "g":
		if len(m.filtered) > 0 {
			m.cursor = 0
			m.scrollOffset = 0
			return m, m.loadCurrentReport()
		}

	case "G":
		if len(m.filtered) > 0 {
			m.cursor = len(m.filtered) - 1
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "pgdown", "ctrl+d":
		if len(m.filtered) > 0 {
			halfPage := m.height / 2
			if halfPage < 1 {
				halfPage = 1
			}
			m.cursor += halfPage
			if m.cursor >= len(m.filtered) {
				m.cursor = len(m.filtered) - 1
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "pgup", "ctrl+u":
		if len(m.filtered) > 0 {
			halfPage := m.height / 2
			if halfPage < 1 {
				halfPage = 1
			}
			m.cursor -= halfPage
			if m.cursor < 0 {
				m.cursor = 0
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}
	}

	return m, nil
}

// handleSearchInput consumes keys while the search input bar is open.
// Esc cancels (closes input AND clears query). Enter commits (closes input,
// keeps query, refreshes filtered list). Backspace + printable chars edit
// the query and live-update the filter so the user sees results as they type.
//
// Report previews are NOT lazy-loaded on every keystroke — that would trigger
// a synchronous os.ReadFile per rune/backspace/ctrl+u and stutter live
// typing. Instead the load fires once when the user commits (Enter) or
// cancels (Esc); subsequent cursor movement in handleKey loads as before.
func (m PipelineModel) handleSearchInput(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.searchInput = false
		m.searchQuery = ""
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, m.loadCurrentReport()

	case "enter":
		m.searchInput = false
		// Query already applied during typing; load the preview for the
		// committed first match (skipped during typing for perf).
		return m, m.loadCurrentReport()

	case "backspace":
		if len(m.searchQuery) > 0 {
			// Drop the last UTF-8 rune so multi-byte characters delete cleanly.
			runes := []rune(m.searchQuery)
			m.searchQuery = string(runes[:len(runes)-1])
			m.applyFilterAndSort()
			m.cursor = 0
			m.scrollOffset = 0
		}
		return m, nil

	case "ctrl+u":
		// vim-flavored: clear the in-progress query without leaving search mode.
		m.searchQuery = ""
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, nil
	}

	// Append printable runes (ignore other special keys like arrows / ctrl-combos).
	if r := msg.Runes; len(r) > 0 {
		m.searchQuery += strings.ToLower(string(r))
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0
		return m, nil
	}
	return m, nil
}

func (m PipelineModel) handleStatusPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.statusPicker = false
		return m, nil

	case "down", "j":
		m.statusCursor++
		if m.statusCursor >= len(statusOptions) {
			m.statusCursor = len(statusOptions) - 1
		}

	case "up", "k":
		m.statusCursor--
		if m.statusCursor < 0 {
			m.statusCursor = 0
		}

	case "enter":
		m.statusPicker = false
		if app, ok := m.CurrentApp(); ok {
			newStatus := statusOptions[m.statusCursor]
			return m, func() tea.Msg {
				return PipelineUpdateStatusMsg{
					GigOpsPath: m.gigOpsPath,
					Lead:       app,
					NewStatus:     newStatus,
				}
			}
		}
	}
	return m, nil
}

// handleColPicker consumes keys while the column picker overlay is open.
func (m PipelineModel) handleColPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q", "C":
		m.colPicker = false
		return m, nil

	case "down", "j":
		m.colPickerIdx++
		if m.colPickerIdx >= len(optionalCols) {
			m.colPickerIdx = len(optionalCols) - 1
		}

	case "up", "k":
		m.colPickerIdx--
		if m.colPickerIdx < 0 {
			m.colPickerIdx = 0
		}

	case " ":
		col := optionalCols[m.colPickerIdx]
		m.visibleCols[col.id] = !m.visibleCols[col.id]
	}
	return m, nil
}

func (m PipelineModel) loadCurrentReport() tea.Cmd {
	app, ok := m.CurrentApp()
	if !ok || app.ReportPath == "" {
		return nil
	}
	if _, cached := m.reportCache[app.ReportPath]; cached {
		return nil
	}
	path := m.gigOpsPath
	report := app.ReportPath
	return func() tea.Msg {
		return PipelineLoadReportMsg{GigOpsPath: path, ReportPath: report}
	}
}

// matchesSearch reports whether lead contains the query as a case-insensitive
// substring of its source, gig, or poster. Empty query matches everything.
func matchesSearch(app model.Lead, query string) bool {
	if query == "" {
		return true
	}
	q := strings.ToLower(query)
	if strings.Contains(strings.ToLower(app.Source), q) {
		return true
	}
	if strings.Contains(strings.ToLower(app.Gig), q) {
		return true
	}
	if strings.Contains(strings.ToLower(app.Poster), q) {
		return true
	}
	return false
}

// applyFilterAndSort rebuilds the filtered list from apps.
func (m *PipelineModel) applyFilterAndSort() {
	var filtered []model.Lead

	currentFilter := pipelineTabs[m.activeTab].filter
	for _, app := range m.apps {
		if !matchesSearch(app, m.searchQuery) {
			continue
		}
		norm := data.NormalizeStatus(app.Status)
		switch currentFilter {
		case filterAll:
			filtered = append(filtered, app)
		case filterTop:
			if app.Score >= 4.0 && norm != "dropped" {
				filtered = append(filtered, app)
			}
		default:
			if norm == currentFilter {
				filtered = append(filtered, app)
			}
		}
	}

	// Sort
	less := m.sortLess()
	sort.SliceStable(filtered, func(i, j int) bool {
		return less(filtered[i], filtered[j])
	})

	// In grouped mode, always sort by status priority first, then by selected sort within groups
	if m.viewMode == "grouped" {
		sort.SliceStable(filtered, func(i, j int) bool {
			pi := data.StatusPriority(filtered[i].Status)
			pj := data.StatusPriority(filtered[j].Status)
			if pi != pj {
				return pi < pj
			}
			// Within same group, use selected sort
			return less(filtered[i], filtered[j])
		})
	}

	m.filtered = filtered
}

// sortLess returns the comparator for the active sort mode. Shared by the flat
// sort and the within-group tiebreaker in grouped view.
func (m PipelineModel) sortLess() func(a, b model.Lead) bool {
	switch m.sortMode {
	case sortDate:
		return func(a, b model.Lead) bool { return a.Date > b.Date }
	case sortSource:
		return func(a, b model.Lead) bool {
			return strings.ToLower(a.Source) < strings.ToLower(b.Source)
		}
	case sortStatus:
		return func(a, b model.Lead) bool {
			return data.StatusPriority(a.Status) < data.StatusPriority(b.Status)
		}
	case sortChannel:
		return func(a, b model.Lead) bool {
			return strings.ToLower(a.Channel) < strings.ToLower(b.Channel)
		}
	case sortRate:
		return func(a, b model.Lead) bool { return a.Rate > b.Rate }
	case sortFollowup:
		// Soonest follow-up first; empty dates sink to the bottom.
		return func(a, b model.Lead) bool {
			if a.NextFollowup == "" {
				return false
			}
			if b.NextFollowup == "" {
				return true
			}
			return a.NextFollowup < b.NextFollowup
		}
	default: // sortScore
		return func(a, b model.Lead) bool { return a.Score > b.Score }
	}
}


// chromeRowsFixed returns the number of fixed chrome rows above/below the body
// (header + tabs(2) + metrics + sortbar + column header + help + 1 search bar
// when active). Shared by View() and adjustScroll() so additions stay in sync.
func (m PipelineModel) chromeRowsFixed() int {
	rows := 8 // header + tabs(2) + metrics + sortbar + column header + help + preview baseline
	if m.searchInput || m.searchQuery != "" {
		rows++
	}
	return rows
}

// previewBudgetApprox is the approximate row count reserved for the preview block
// when computing scroll positioning. View() measures the actual rendered preview
// height; adjustScroll uses this constant to avoid re-rendering on every keystroke.
const previewBudgetApprox = 6

// adjustScroll updates scrollOffset so the cursor stays visible.
func (m *PipelineModel) adjustScroll() {
	availHeight := m.height - m.chromeRowsFixed() - previewBudgetApprox
	if availHeight < 5 {
		availHeight = 5
	}
	line := m.cursorLineEstimate()
	margin := 3

	if line >= m.scrollOffset+availHeight-margin {
		m.scrollOffset = line - availHeight + margin + 1
	}
	if line < m.scrollOffset+margin {
		m.scrollOffset = line - margin
	}
	if m.scrollOffset < 0 {
		m.scrollOffset = 0
	}
}

func (m PipelineModel) cursorLineEstimate() int {
	if m.viewMode != "grouped" {
		return m.cursor
	}
	// Account for group headers
	line := 0
	prevStatus := ""
	for i, app := range m.filtered {
		norm := data.NormalizeStatus(app.Status)
		if norm != prevStatus {
			line++ // group header
			prevStatus = norm
		}
		if i == m.cursor {
			return line
		}
		line++
	}
	return line
}

// -- View --

// View renders the pipeline screen.
func (m PipelineModel) View() string {
	header := m.renderHeader()
	tabs := m.renderTabs()
	metricsBar := m.renderMetrics()
	sortBar := m.renderSortBar()
	searchBar := m.renderSearchBar()
	body := m.renderBody()
	preview := m.renderPreview()
	help := m.renderHelp()

	// Apply scroll to body
	bodyLines := strings.Split(body, "\n")
	if m.scrollOffset > 0 && m.scrollOffset < len(bodyLines) {
		bodyLines = bodyLines[m.scrollOffset:]
	}

	// Calculate available height for body
	previewLines := strings.Count(preview, "\n") + 1
	availHeight := m.height - m.chromeRowsFixed() - previewLines
	if availHeight < 3 {
		availHeight = 3
	}
	if len(bodyLines) > availHeight {
		bodyLines = bodyLines[:availHeight]
	}
	body = strings.Join(bodyLines, "\n")

	// Column picker overlay
	if m.colPicker {
		body = m.overlayColPicker(body)
	}

	// Status picker overlay
	if m.statusPicker {
		body = m.overlayStatusPicker(body)
	}

	sections := []string{header, tabs, metricsBar, sortBar}
	if searchBar != "" {
		sections = append(sections, searchBar)
	}
	sections = append(sections, m.renderColumnHeader(), body, preview, help)
	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

// renderSearchBar returns an empty string when there is no active or in-progress
// search; otherwise it renders a vim-style status line showing the query and the
// match count. While in input mode, a trailing cursor is appended.
func (m PipelineModel) renderSearchBar() string {
	if !m.searchInput && m.searchQuery == "" {
		return ""
	}

	style := lipgloss.NewStyle().
		Foreground(m.theme.Text).
		Width(m.width).
		Padding(0, 2)

	prompt := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render("/")
	queryStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	hintStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	display := queryStyle.Render(m.searchQuery)
	if m.searchInput {
		display += lipgloss.NewStyle().Foreground(m.theme.Blue).Render("█")
	}

	tabFiltered := m.countForFilter(pipelineTabs[m.activeTab].filter)
	matchInfo := hintStyle.Render(fmt.Sprintf("  %d/%d matching", len(m.filtered), tabFiltered))

	hint := ""
	if m.searchInput {
		hint = hintStyle.Render("   Enter: keep   Esc: cancel   Ctrl+U: clear")
	} else {
		hint = hintStyle.Render("   Esc: clear   /: edit")
	}

	return style.Render(prompt + " " + display + matchInfo + hint)
}

func (m PipelineModel) renderHeader() string {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	avg := fmt.Sprintf("%.1f", m.metrics.AvgScore)
	info := right.Render(fmt.Sprintf("%d leads | Avg %s/5", m.metrics.Total, avg))

	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render("GIG PIPELINE")
	gap := m.width - lipgloss.Width(title) - lipgloss.Width(info) - 4
	if gap < 1 {
		gap = 1
	}

	return style.Render(title + strings.Repeat(" ", gap) + info)
}

func (m PipelineModel) renderTabs() string {
	var tabs []string
	var underParts []string

	for i, tab := range pipelineTabs {
		// Count items for this tab
		count := m.countForFilter(tab.filter)
		label := fmt.Sprintf(" %s (%d) ", tab.label, count)

		if i == m.activeTab {
			style := lipgloss.NewStyle().
				Bold(true).
				Foreground(m.theme.Blue).
				Padding(0, 0)
			tabs = append(tabs, style.Render(label))
			underParts = append(underParts, strings.Repeat("━", lipgloss.Width(label)))
		} else {
			style := lipgloss.NewStyle().
				Foreground(m.theme.Subtext).
				Padding(0, 0)
			tabs = append(tabs, style.Render(label))
			underParts = append(underParts, strings.Repeat("─", lipgloss.Width(label)))
		}
	}

	row := lipgloss.JoinHorizontal(lipgloss.Top, tabs...)
	underline := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render(strings.Join(underParts, ""))

	padStyle := lipgloss.NewStyle().Padding(0, 1)
	return padStyle.Render(row) + "\n" + padStyle.Render(underline)
}

func (m PipelineModel) countForFilter(filter string) int {
	count := 0
	for _, app := range m.apps {
		norm := data.NormalizeStatus(app.Status)
		switch filter {
		case filterAll:
			count++
		case filterTop:
			if app.Score >= 4.0 && norm != "skip" {
				count++
			}
		default:
			if norm == filter {
				count++
			}
		}
	}
	return count
}

func (m PipelineModel) renderMetrics() string {
	style := lipgloss.NewStyle().
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	var parts []string
	statusColors := m.statusColorMap()

	for _, status := range statusGroupOrder {
		count, ok := m.metrics.ByStatus[status]
		if !ok || count == 0 {
			continue
		}
		color := statusColors[status]
		s := lipgloss.NewStyle().Foreground(color)
		parts = append(parts, s.Render(fmt.Sprintf("%s:%d", statusLabel(status), count)))
	}

	return style.Render(strings.Join(parts, "  "))
}

func (m PipelineModel) renderSortBar() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Width(m.width).
		Padding(0, 2)

	sortLabel := fmt.Sprintf("[Sort: %s]", m.sortMode)
	viewLabel := fmt.Sprintf("[View: %s]", m.viewMode)
	count := fmt.Sprintf("%d shown", len(m.filtered))

	return style.Render(fmt.Sprintf("%s  %s  %s", sortLabel, viewLabel, count))
}

func (m PipelineModel) renderBody() string {
	if len(m.filtered) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(m.theme.Subtext).
			Padding(1, 2)
		return emptyStyle.Render("No leads match this filter")
	}

	var lines []string
	prevStatus := ""
	padStyle := lipgloss.NewStyle().Padding(0, 2)

	for i, app := range m.filtered {
		norm := data.NormalizeStatus(app.Status)

		// Group header in grouped mode
		if m.viewMode == "grouped" && norm != prevStatus {
			count := m.countByNormStatus(norm)
			headerStyle := lipgloss.NewStyle().
				Bold(true).
				Foreground(m.theme.Subtext)
			lines = append(lines, padStyle.Render(
				headerStyle.Render(fmt.Sprintf("── %s (%d) %s",
					strings.ToUpper(statusLabel(norm)), count,
					strings.Repeat("─", max(0, m.width-30-len(statusLabel(norm)))))),
			))
			prevStatus = norm
		}

		selected := i == m.cursor
		line := m.renderAppLine(app, selected)
		lines = append(lines, line)
	}

	return strings.Join(lines, "\n")
}

// colWidths holds per-column rune budgets for the table.
type colWidths struct {
	num, score, source, status, gig int
	// optional columns — 0 means the column is hidden
	date, channel, rate, rpt, followup int
}

func (m PipelineModel) colVisible(id ColumnID) bool {
	if m.visibleCols == nil {
		// Fall back to default for callers before init (tests, etc.)
		for _, col := range optionalCols {
			if col.id == id {
				return col.onByDefault
			}
		}
		return false
	}
	return m.visibleCols[id]
}

func (m PipelineModel) columnWidths() colWidths {
	c := colWidths{num: 5, score: 5, source: 14, status: 12}
	if m.colVisible(ColDate) {
		c.date = 10
	}
	if m.colVisible(ColChannel) {
		c.channel = 12
	}
	if m.colVisible(ColRate) {
		c.rate = 14
	}
	if m.colVisible(ColHasReport) {
		c.rpt = 4
	}
	if m.colVisible(ColFollowup) {
		c.followup = 10
	}
	fixed := c.num + c.score + c.date + c.source + c.status + c.channel + c.rate + c.rpt + c.followup
	c.gig = m.width - fixed - 14 // separators + outer padding
	if c.gig < 15 {
		c.gig = 15
	}
	return c
}

func (m PipelineModel) renderChannelCell(app model.Lead, width int) string {
	text := app.Channel
	if text == "" {
		text = "—"
	}
	color := m.theme.Subtext
	switch strings.ToLower(text) {
	case "dm":
		color = m.theme.Blue
	case "email":
		color = m.theme.Sky
	case "comment":
		color = m.theme.Yellow
	case "apply":
		color = m.theme.Green
	}
	return lipgloss.NewStyle().Foreground(color).Width(width).Render(truncateRunes(text, width))
}

func (m PipelineModel) renderCheckCell(yes bool, width int) string {
	text := "—"
	color := m.theme.Subtext
	if yes {
		text = "✓"
		color = m.theme.Green
	}
	return lipgloss.NewStyle().Foreground(color).Width(width).Render(text)
}

func (m PipelineModel) renderRateCell(app model.Lead, width int) string {
	text := app.Rate
	if text == "" {
		return lipgloss.NewStyle().Width(width).Render("")
	}
	return lipgloss.NewStyle().Foreground(m.theme.Green).Width(width).Render(truncateRunes(text, width-1))
}

// renderColumnHeader labels the table columns; widths mirror renderAppLine.
func (m PipelineModel) renderColumnHeader() string {
	cw := m.columnWidths()
	h := lipgloss.NewStyle().Foreground(m.theme.Subtext).Bold(true)
	cell := func(label string, width int) string {
		return h.Width(width).Render(truncateRunes(label, width))
	}

	segments := []string{
		cell("#", cw.num),
		h.Render("FIT"), // score cell is unpadded, always 3 runes wide
	}
	if cw.date > 0 {
		segments = append(segments, cell("DATE", cw.date))
	}
	segments = append(segments, cell("SOURCE", cw.source))
	segments = append(segments, cell("GIG", cw.gig))
	segments = append(segments, cell("STATUS", cw.status))
	if cw.channel > 0 {
		segments = append(segments, cell("CHANNEL", cw.channel))
	}
	if cw.rate > 0 {
		segments = append(segments, cell("RATE", cw.rate))
	}
	if cw.rpt > 0 {
		segments = append(segments, cell("RPT", cw.rpt))
	}
	if cw.followup > 0 {
		segments = append(segments, cell("FOLLOWUP", cw.followup))
	}

	padStyle := lipgloss.NewStyle().Padding(0, 2)
	return padStyle.Render(" " + strings.Join(segments, " "))
}

func (m PipelineModel) renderAppLine(app model.Lead, selected bool) string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	cw := m.columnWidths()

	// Tracker number (fixed width)
	numText := "#—"
	if app.Number > 0 {
		numText = fmt.Sprintf("#%d", app.Number)
	}
	numStyle := lipgloss.NewStyle().Foreground(m.theme.Blue).Bold(true).Width(cw.num)

	// Score with color
	scoreStyle := m.scoreStyle(app.Score)
	score := scoreStyle.Render(fmt.Sprintf("%.1f", app.Score))

	// Source (truncate)
	source := truncateRunes(app.Source, cw.source)
	sourceStyle := lipgloss.NewStyle().Foreground(m.theme.Text).Width(cw.source)

	// Date (fixed width)
	dateText := app.Date
	if dateText == "" {
		dateText = "—"
	}
	dateStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(cw.date)

	// Gig (truncate)
	gig := truncateRunes(app.Gig, cw.gig)
	gigStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(cw.gig)

	// Status with color -- fixed column
	norm := data.NormalizeStatus(app.Status)
	statusColor := m.statusColorMap()[norm]
	statusStyle := lipgloss.NewStyle().Foreground(statusColor).Width(cw.status)
	statusText := statusStyle.Render(statusLabel(norm))

	segments := []string{
		numStyle.Render(truncateRunes(numText, cw.num)),
		score,
	}
	if cw.date > 0 {
		segments = append(segments, dateStyle.Render(truncateRunes(dateText, cw.date)))
	}
	segments = append(segments, sourceStyle.Render(source))
	segments = append(segments, gigStyle.Render(gig))
	segments = append(segments, statusText)

	if cw.channel > 0 {
		segments = append(segments, m.renderChannelCell(app, cw.channel))
	}
	if cw.rate > 0 {
		segments = append(segments, m.renderRateCell(app, cw.rate))
	}
	if cw.rpt > 0 {
		segments = append(segments, m.renderCheckCell(app.ReportPath != "", cw.rpt))
	}
	if cw.followup > 0 {
		followupText := "—"
		if app.NextFollowup != "" {
			followupText = formatTimeAgo(app.NextFollowup)
		}
		followupStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(cw.followup)
		if app.NextFollowup != "" {
			followupStyle = followupStyle.Foreground(m.theme.Yellow)
		}
		segments = append(segments, followupStyle.Render(truncateRunes(followupText, cw.followup)))
	}

	line := " " + strings.Join(segments, " ")

	if selected {
		selStyle := lipgloss.NewStyle().
			Background(m.theme.Overlay).
			Width(m.width - 4)
		return padStyle.Render(selStyle.Render(line))
	}
	return padStyle.Render(line)
}

func (m PipelineModel) renderPreview() string {
	app, ok := m.CurrentApp()
	if !ok {
		return ""
	}

	padStyle := lipgloss.NewStyle().Padding(0, 2)
	divider := lipgloss.NewStyle().Foreground(m.theme.Overlay)

	var lines []string
	lines = append(lines, padStyle.Render(divider.Render(strings.Repeat("─", m.width-4))))

	labelStyle := lipgloss.NewStyle().Foreground(m.theme.Sky).Bold(true)
	valueStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	// Quick facts from tracker columns.
	var facts []string
	if app.Poster != "" {
		facts = append(facts, labelStyle.Render("Poster: ")+valueStyle.Render(app.Poster))
	}
	if app.Channel != "" {
		facts = append(facts, labelStyle.Render("Channel: ")+valueStyle.Render(app.Channel))
	}
	if app.Rate != "" {
		facts = append(facts, labelStyle.Render("Rate: ")+valueStyle.Render(app.Rate))
	}
	if app.NextFollowup != "" {
		facts = append(facts, labelStyle.Render("Follow-up: ")+
			valueStyle.Render(fmt.Sprintf("%s (%s)", app.NextFollowup, formatTimeAgo(app.NextFollowup))))
	}
	if len(facts) > 0 {
		lines = append(lines, padStyle.Render(strings.Join(facts, "   ")))
	}

	outcome := previewOutcome(app)

	// Check report cache
	if summary, ok := m.reportCache[app.ReportPath]; ok {
		if summary.archetype != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("Archetype: ")+valueStyle.Render(summary.archetype)))
		}
		if summary.tldr != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("TL;DR: ")+valueStyle.Render(summary.tldr)))
		}
	} else if outcome == "" {
		lines = append(lines, padStyle.Render(dimStyle.Render("Loading preview...")))
	}

	// Closed-out postings: surface what happened as the last preview line.
	// The notes-only fallback above disappears once a report summary is
	// cached, which is exactly when the discard reason got lost (#787).
	if outcome != "" {
		// Width budget: 4 cols padding + 9 for the "Outcome: " label + slack,
		// mirroring the m.width-10 budget of the notes fallback above.
		lines = append(lines, padStyle.Render(
			labelStyle.Render("Outcome: ")+valueStyle.Render(truncateRunes(outcome, m.width-14))))
	}

	return strings.Join(lines, "\n")
}

// previewOutcome returns "what happened" to a closed-out lead. Returns "" for leads still active.
func previewOutcome(app model.Lead) string {
	switch data.NormalizeStatus(app.Status) {
	case "lost", "dropped":
	default:
		return ""
	}
	return strings.TrimSpace(app.Status)
}

func (m PipelineModel) renderHelp() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 1)

	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)
	descStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	if m.colPicker {
		return style.Render(
			keyStyle.Render("↑↓/jk") + descStyle.Render(" navigate  ") +
				keyStyle.Render("SPACE") + descStyle.Render(" toggle  ") +
				keyStyle.Render("Esc/C") + descStyle.Render(" close"))
	}

	if m.statusPicker {
		return style.Render(
			keyStyle.Render("↑↓/jk") + descStyle.Render(" navigate  ") +
				keyStyle.Render("Enter") + descStyle.Render(" confirm  ") +
				keyStyle.Render("Esc") + descStyle.Render(" cancel"))
	}

	if m.searchInput {
		return style.Render(
			keyStyle.Render("type") + descStyle.Render(" filter live  ") +
				keyStyle.Render("Enter") + descStyle.Render(" keep  ") +
				keyStyle.Render("Ctrl+U") + descStyle.Render(" clear  ") +
				keyStyle.Render("Esc") + descStyle.Render(" cancel"))
	}

	brand := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render("gig-ops")

	keys := keyStyle.Render("↑↓/jk") + descStyle.Render(" nav  ") +
		keyStyle.Render("←→/hl") + descStyle.Render(" tabs  ") +
		keyStyle.Render("/") + descStyle.Render(" search  ") +
		keyStyle.Render("s") + descStyle.Render(" sort  ") +
		keyStyle.Render("r") + descStyle.Render(" refresh  ") +
		keyStyle.Render("Enter") + descStyle.Render(" report  ") +
		keyStyle.Render("o") + descStyle.Render(" open URL  ") +
		keyStyle.Render("c") + descStyle.Render(" change  ") +
		keyStyle.Render("C") + descStyle.Render(" columns  ") +
		keyStyle.Render("v") + descStyle.Render(" view  ") +
		keyStyle.Render("p") + descStyle.Render(" progress  ") +
		keyStyle.Render("q") + descStyle.Render(" quit")

	gap := m.width - lipgloss.Width(keys) - lipgloss.Width(brand) - 2
	if gap < 1 {
		gap = 1
	}

	return style.Render(keys + strings.Repeat(" ", gap) + brand)
}

func (m PipelineModel) overlayStatusPicker(body string) string {
	// Render status picker inline at bottom of body
	bodyLines := strings.Split(body, "\n")

	pickerWidth := 30
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	borderStyle := lipgloss.NewStyle().
		Foreground(m.theme.Blue).
		Bold(true)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render("Change status:")))

	for i, opt := range statusOptions {
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.statusCursor {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		prefix := "  "
		if i == m.statusCursor {
			prefix = "> "
		}
		picker = append(picker, padStyle.Render(style.Render(prefix+opt)))
	}

	// Append picker to body
	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

// overlayColPicker renders the column visibility picker inline at the bottom
// of the body. SPACE toggles the focused column; ESC or C closes.
func (m PipelineModel) overlayColPicker(body string) string {
	bodyLines := strings.Split(body, "\n")
	pickerWidth := 36
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Blue).Bold(true)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render("─── Columns (SPACE toggle · ESC close) ───")))

	for i, col := range optionalCols {
		on := m.visibleCols[col.id]
		check := "[ ]"
		checkColor := m.theme.Subtext
		if on {
			check = "[✓]"
			checkColor = m.theme.Green
		}
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.colPickerIdx {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		checkStr := lipgloss.NewStyle().Foreground(checkColor).Render(check)
		label := col.header
		if col.hint != "" {
			label += "  " + dimStyle.Render(col.hint)
		}
		row := checkStr + " " + label
		picker = append(picker, padStyle.Render(style.Render(row)))
	}

	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

// -- Helpers --

func (m PipelineModel) scoreStyle(score float64) lipgloss.Style {
	switch {
	case score >= 4.2:
		return lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true)
	case score >= 3.8:
		return lipgloss.NewStyle().Foreground(m.theme.Yellow)
	case score >= 3.0:
		return lipgloss.NewStyle().Foreground(m.theme.Text)
	default:
		return lipgloss.NewStyle().Foreground(m.theme.Red)
	}
}

func (m PipelineModel) statusColorMap() map[string]lipgloss.Color {
	return map[string]lipgloss.Color{
		"won":         m.theme.Green,
		"negotiating": m.theme.Green,
		"replied":     m.theme.Blue,
		"contacted":   m.theme.Sky,
		"new":         m.theme.Text,
		"lost":        m.theme.Subtext,
		"dropped":     m.theme.Subtext,
	}
}

func (m PipelineModel) countByNormStatus(status string) int {
	count := 0
	for _, app := range m.filtered {
		if data.NormalizeStatus(app.Status) == status {
			count++
		}
	}
	return count
}

// formatTimeAgo renders an ISO date as a relative duration in calendar days:
// "today", "yesterday", or "Nd ago". Tracker dates are day-granular (no
// time-of-day), so we never report sub-day hours — doing so would fabricate
// precision the data doesn't have (e.g. an entry dated today would otherwise
// read "13h ago" simply because it's 1pm, not because contact was 13h back).
func formatTimeAgo(dateStr string) string {
	t, err := time.ParseInLocation("2006-01-02", dateStr, time.Local)
	if err != nil {
		return dateStr // not a date — show it untouched rather than lie
	}
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	contactDay := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
	// Round to the nearest day so DST transitions don't skew the count.
	days := int(math.Round(today.Sub(contactDay).Hours() / 24))
	switch {
	case days <= 0:
		return "today"
	case days == 1:
		return "yesterday"
	default:
		return fmt.Sprintf("%dd ago", days)
	}
}

// truncateRunes truncates a string to at most maxRunes runes, appending "..." if truncated.
func truncateRunes(s string, maxRunes int) string {
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	if maxRunes <= 3 {
		return string(runes[:maxRunes])
	}
	return string(runes[:maxRunes-3]) + "..."
}

func statusLabel(norm string) string {
	switch norm {
	case "won":
		return "Won"
	case "negotiating":
		return "Negotiating"
	case "replied":
		return "Replied"
	case "contacted":
		return "Contacted"
	case "new":
		return "New"
	case "lost":
		return "Lost"
	case "dropped":
		return "Dropped"
	default:
		return norm
	}
}
