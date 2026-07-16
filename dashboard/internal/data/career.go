package data

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/santifer/gig-pilot/dashboard/internal/model"
)

var (
	reReportLink = regexp.MustCompile(`\[(\d+)\]\(([^)]+)\)`)
	reScoreValue = regexp.MustCompile(`(\d+\.?\d*)/5`)
	reArchetype  = regexp.MustCompile(`(?i)\*\*(?:Arquetipo|Archetype)(?:\s+(?:detectado|detected))?\*\*\s*\|\s*(.+)`)
	reTlDr       = regexp.MustCompile(`(?i)\*\*TL;DR\*\*\s*\|\s*(.+)`)
	reTlDrColon  = regexp.MustCompile(`(?i)\*\*TL;DR:\*\*\s*(.+)`)
	reReportURL  = regexp.MustCompile(`(?m)^\*\*URL:\*\*\s*(https?://\S+)`)
)

// ParseLeads reads data/leads.md (tab-separated) and returns parsed leads.
func ParseLeads(gigPilotPath string) []model.Lead {
	filePath := filepath.Join(gigPilotPath, "data", "leads.md")
	content, err := os.ReadFile(filePath)
	if err != nil {
		// Fallback: try root directory
		filePath = filepath.Join(gigPilotPath, "leads.md")
		content, err = os.ReadFile(filePath)
		if err != nil {
			return nil
		}
	}

	lines := strings.Split(string(content), "\n")
	leads := make([]model.Lead, 0)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		fields := strings.Split(line, "\t")
		if len(fields) < 7 {
			continue
		}

		for i := range fields {
			fields[i] = strings.TrimSpace(fields[i])
		}

		lead := model.Lead{}

		// Field 0: num
		if n, err2 := strconv.Atoi(fields[0]); err2 == nil {
			lead.Number = n
			lead.ReportNumber = fields[0]
		}

		// Field 1: date
		lead.Date = fields[1]

		// Field 2: source
		lead.Source = fields[2]

		// Field 3: poster
		if len(fields) > 3 {
			lead.Poster = fields[3]
		}

		// Field 4: gig title
		if len(fields) > 4 {
			lead.Gig = fields[4]
		}

		// Field 5: channel
		if len(fields) > 5 {
			lead.Channel = fields[5]
		}

		// Field 6: status
		if len(fields) > 6 {
			lead.Status = fields[6]
		}

		// Field 7: score  (e.g. "4.2/5")
		if len(fields) > 7 {
			lead.ScoreRaw = fields[7]
			if sm := reScoreValue.FindStringSubmatch(fields[7]); sm != nil {
				lead.Score, _ = strconv.ParseFloat(sm[1], 64)
			}
		}

		// Field 8: rate
		if len(fields) > 8 {
			lead.Rate = fields[8]
		}

		// Field 9: next_followup
		if len(fields) > 9 {
			lead.NextFollowup = fields[9]
		}

		// Field 10: report link  [num](path)
		if len(fields) > 10 {
			if rm := reReportLink.FindStringSubmatch(fields[10]); rm != nil {
				lead.ReportNumber = rm[1]
				lead.ReportPath = rm[2]
			}
		}

		leads = append(leads, lead)
	}

	// Enrich with job URLs from report headers
	for i := range leads {
		if leads[i].ReportPath == "" {
			continue
		}
		fullReport := filepath.Join(gigPilotPath, leads[i].ReportPath)
		reportContent, err2 := os.ReadFile(fullReport)
		if err2 != nil {
			continue
		}
		header := string(reportContent)
		if len(header) > 1000 {
			header = header[:1000]
		}
		if m := reReportURL.FindStringSubmatch(header); m != nil {
			leads[i].JobURL = m[1]
		}
	}

	return leads
}

// ComputeMetrics calculates aggregate metrics from leads.
func ComputeMetrics(leads []model.Lead) model.PipelineMetrics {
	m := model.PipelineMetrics{
		Total:    len(leads),
		ByStatus: make(map[string]int),
	}

	var totalScore float64
	var scored int

	for _, lead := range leads {
		status := NormalizeStatus(lead.Status)
		m.ByStatus[status]++

		if lead.Score > 0 {
			totalScore += lead.Score
			scored++
			if lead.Score > m.TopScore {
				m.TopScore = lead.Score
			}
		}
		if status != "lost" && status != "dropped" {
			m.Actionable++
		}
	}

	if scored > 0 {
		m.AvgScore = totalScore / float64(scored)
	}

	return m
}

// NormalizeStatus normalizes raw status text to a canonical form.
func NormalizeStatus(raw string) string {
	s := strings.TrimSpace(strings.ToLower(raw))
	switch {
	case s == "won" || strings.Contains(s, "won"):
		return "won"
	case s == "negotiating" || strings.Contains(s, "negot"):
		return "negotiating"
	case s == "replied" || strings.Contains(s, "replied"):
		return "replied"
	case s == "contacted" || strings.Contains(s, "contacted"):
		return "contacted"
	case s == "new" || s == "":
		return "new"
	case s == "lost" || strings.Contains(s, "lost"):
		return "lost"
	case s == "dropped" || strings.Contains(s, "dropped") || strings.Contains(s, "skip"):
		return "dropped"
	default:
		return s
	}
}

// LoadReportSummary extracts key fields from a gig evaluation report.
func LoadReportSummary(gigPilotPath, reportPath string) (archetype, tldr string) {
	fullPath := filepath.Join(gigPilotPath, reportPath)
	content, err := os.ReadFile(fullPath)
	if err != nil {
		return
	}
	text := string(content)

	if m := reArchetype.FindStringSubmatch(text); m != nil {
		archetype = cleanTableCell(m[1])
	}

	if m := reTlDr.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	} else if m := reTlDrColon.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	}

	if len(tldr) > 120 {
		tldr = tldr[:117] + "..."
	}

	return
}

// UpdateLeadStatus updates the status of a lead in leads.md.
func UpdateLeadStatus(gigPilotPath string, lead model.Lead, newStatus string) error {
	filePath := filepath.Join(gigPilotPath, "data", "leads.md")
	content, err := os.ReadFile(filePath)
	if err != nil {
		filePath = filepath.Join(gigPilotPath, "leads.md")
		content, err = os.ReadFile(filePath)
		if err != nil {
			return err
		}
	}

	lines := strings.Split(string(content), "\n")
	found := false
	numStr := strconv.Itoa(lead.Number)

	for i, line := range lines {
		fields := strings.Split(line, "\t")
		if len(fields) < 7 {
			continue
		}
		if strings.TrimSpace(fields[0]) == numStr {
			fields[6] = newStatus
			lines[i] = strings.Join(fields, "\t")
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("lead not found: #%d", lead.Number)
	}

	return os.WriteFile(filePath, []byte(strings.Join(lines, "\n")), 0644)
}

// cleanTableCell removes trailing pipes and whitespace from a table cell value.
func cleanTableCell(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "|")
	return strings.TrimSpace(s)
}

// StatusPriority returns the sort priority for a status (lower = higher priority).
func StatusPriority(status string) int {
	switch NormalizeStatus(status) {
	case "negotiating":
		return 0
	case "won":
		return 1
	case "replied":
		return 2
	case "contacted":
		return 3
	case "new":
		return 4
	case "lost":
		return 5
	case "dropped":
		return 6
	default:
		return 7
	}
}

// ComputeProgressMetrics computes progress-oriented analytics from leads.
func ComputeProgressMetrics(leads []model.Lead) model.ProgressMetrics {
	pm := model.ProgressMetrics{}

	statusCounts := make(map[string]int)
	var totalScore float64
	var scored int

	for _, lead := range leads {
		norm := NormalizeStatus(lead.Status)
		statusCounts[norm]++

		if lead.Score > 0 {
			totalScore += lead.Score
			scored++
			if lead.Score > pm.TopScore {
				pm.TopScore = lead.Score
			}
		}

		if norm == "won" {
			pm.TotalWon++
		}
		if norm != "lost" && norm != "dropped" {
			pm.ActiveLeads++
		}
	}

	if scored > 0 {
		pm.AvgScore = totalScore / float64(scored)
	}

	total := len(leads)
	contacted := statusCounts["contacted"] + statusCounts["replied"] + statusCounts["negotiating"] + statusCounts["won"] + statusCounts["lost"]
	replied := statusCounts["replied"] + statusCounts["negotiating"] + statusCounts["won"]
	negotiating := statusCounts["negotiating"] + statusCounts["won"]
	won := statusCounts["won"]

	pm.FunnelStages = []model.FunnelStage{
		{Label: "Scanned", Count: total, Pct: 100.0},
		{Label: "Contacted", Count: contacted, Pct: safePct(contacted, total)},
		{Label: "Replied", Count: replied, Pct: safePct(replied, contacted)},
		{Label: "Negotiating", Count: negotiating, Pct: safePct(negotiating, contacted)},
		{Label: "Won", Count: won, Pct: safePct(won, contacted)},
	}

	if contacted > 0 {
		pm.ReplyRate = float64(replied) / float64(contacted) * 100
		pm.NegotiateRate = float64(negotiating) / float64(contacted) * 100
		pm.WinRate = float64(won) / float64(contacted) * 100
	}

	// Score distribution
	buckets := [5]int{}
	for _, lead := range leads {
		if lead.Score <= 0 {
			continue
		}
		switch {
		case lead.Score >= 4.5:
			buckets[0]++
		case lead.Score >= 4.0:
			buckets[1]++
		case lead.Score >= 3.5:
			buckets[2]++
		case lead.Score >= 3.0:
			buckets[3]++
		default:
			buckets[4]++
		}
	}
	pm.ScoreBuckets = []model.ScoreBucket{
		{Label: "4.5-5.0", Count: buckets[0]},
		{Label: "4.0-4.4", Count: buckets[1]},
		{Label: "3.5-3.9", Count: buckets[2]},
		{Label: "3.0-3.4", Count: buckets[3]},
		{Label: "  <3.0", Count: buckets[4]},
	}

	// Weekly activity: group by ISO week, show last 8 weeks.
	weekCounts := make(map[string]int)
	for _, lead := range leads {
		if lead.Date == "" {
			continue
		}
		t, err := time.Parse("2006-01-02", lead.Date)
		if err != nil {
			continue
		}
		year, week := t.ISOWeek()
		key := fmt.Sprintf("%d-W%02d", year, week)
		weekCounts[key]++
	}

	var weeks []string
	for w := range weekCounts {
		weeks = append(weeks, w)
	}
	sort.Strings(weeks)
	if len(weeks) > 8 {
		weeks = weeks[len(weeks)-8:]
	}

	for _, w := range weeks {
		pm.WeeklyActivity = append(pm.WeeklyActivity, model.WeekActivity{
			Week:  w,
			Count: weekCounts[w],
		})
	}

	return pm
}

func safePct(part, whole int) float64 {
	if whole == 0 {
		return 0
	}
	return float64(part) / float64(whole) * 100
}
