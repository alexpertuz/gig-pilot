package main

import (
	"flag"
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/gig-ops/dashboard/internal/data"
	"github.com/santifer/gig-ops/dashboard/internal/model"
	"github.com/santifer/gig-ops/dashboard/internal/theme"
	"github.com/santifer/gig-ops/dashboard/internal/ui/screens"
)

type viewState int

const (
	viewPipeline viewState = iota
	viewReport
	viewProgress
)

type appModel struct {
	pipeline        screens.PipelineModel
	viewer          screens.ViewerModel
	progress        screens.ProgressModel
	state           viewState
	gigOpsPath      string
	theme           theme.Theme
	progressMetrics model.ProgressMetrics
}

func (m *appModel) reloadPipelineData() {
	leads := data.ParseLeads(m.gigOpsPath)
	metrics := data.ComputeMetrics(leads)
	m.progressMetrics = data.ComputeProgressMetrics(leads)
	m.pipeline = m.pipeline.WithReloadedData(leads, metrics)
}

func (m appModel) Init() tea.Cmd {
	return nil
}

func (m appModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.pipeline.Resize(msg.Width, msg.Height)
		if m.state == viewReport {
			m.viewer.Resize(msg.Width, msg.Height)
		}
		if m.state == viewProgress {
			m.progress.Resize(msg.Width, msg.Height)
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd

	case screens.PipelineClosedMsg:
		return m, tea.Quit

	case screens.PipelineLoadReportMsg:
		archetype, tldr := data.LoadReportSummary(msg.GigOpsPath, msg.ReportPath)
		m.pipeline.EnrichReport(msg.ReportPath, archetype, tldr)
		return m, nil

	case screens.PipelineUpdateStatusMsg:
		err := data.UpdateLeadStatus(msg.GigOpsPath, msg.Lead, msg.NewStatus)
		if err != nil {
			fmt.Fprintf(os.Stderr, "WARN: status update failed: %v\n", err)
		}
		m.reloadPipelineData()
		return m, nil

	case screens.PipelineRefreshMsg:
		m.reloadPipelineData()
		return m, nil

	case screens.PipelineOpenReportMsg:
		m.viewer = screens.NewViewerModel(
			m.theme,
			msg.Path, msg.Title,
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewReport
		return m, nil

	case screens.ViewerClosedMsg:
		m.state = viewPipeline
		return m, nil

	case screens.PipelineOpenProgressMsg:
		m.progress = screens.NewProgressModel(
			theme.NewTheme("catppuccin-mocha"),
			m.progressMetrics,
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewProgress
		return m, nil

	case screens.ProgressClosedMsg:
		m.state = viewPipeline
		return m, nil

	case screens.PipelineOpenURLMsg:
		url := msg.URL
		return m, func() tea.Msg {
			if err := openWithDefaultApp(url); err != nil {
				fmt.Fprintf(os.Stderr, "WARN: failed to open URL %q: %v\n", url, err)
			}
			return nil
		}

	default:
		if m.state == viewReport {
			vm, cmd := m.viewer.Update(msg)
			m.viewer = vm
			return m, cmd
		}
		if m.state == viewProgress {
			pg, cmd := m.progress.Update(msg)
			m.progress = pg
			return m, cmd
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd
	}
}

func (m appModel) View() string {
	switch m.state {
	case viewReport:
		return m.viewer.View()
	case viewProgress:
		return m.progress.View()
	default:
		return m.pipeline.View()
	}
}

func main() {
	pathFlag := flag.String("path", ".", "Path to gig-ops directory")
	flag.Parse()

	gigOpsPath := *pathFlag

	leads := data.ParseLeads(gigOpsPath)
	if leads == nil {
		// Empty leads.md is OK — show an empty dashboard
		leads = []model.Lead{}
	}

	metrics := data.ComputeMetrics(leads)
	progressMetrics := data.ComputeProgressMetrics(leads)

	t := theme.NewTheme("auto")
	pm := screens.NewPipelineModel(t, leads, metrics, gigOpsPath, 120, 40)

	for _, lead := range leads {
		if lead.ReportPath == "" {
			continue
		}
		archetype, tldr := data.LoadReportSummary(gigOpsPath, lead.ReportPath)
		if archetype != "" || tldr != "" {
			pm.EnrichReport(lead.ReportPath, archetype, tldr)
		}
	}

	m := appModel{
		pipeline:        pm,
		gigOpsPath:      gigOpsPath,
		theme:           t,
		progressMetrics: progressMetrics,
	}

	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
