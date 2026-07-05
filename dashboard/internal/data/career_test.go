package data

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseLeadsUsesNumberColumn(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("failed to create data dir: %v", err)
	}

	leads := "1\t2026-06-01\tr/forhire\tu/poster1\tNeed a React dev\tdm\tnew\t4.2/5\t$50-75/hr\t2026-06-10\t[1](reports/001-react-dev-2026-06-01.md)\n" +
		"2\t2026-06-02\tremoteok\tAcme Corp\tBackend Engineer\temail\tcontacted\t3.8/5\t$60/hr\t2026-06-12\t[2](reports/002-backend-2026-06-02.md)\n"

	leadsPath := filepath.Join(dataDir, "leads.md")
	if err := os.WriteFile(leadsPath, []byte(leads), 0o644); err != nil {
		t.Fatalf("failed to write leads.md: %v", err)
	}

	parsed := ParseLeads(tempDir)
	if len(parsed) != 2 {
		t.Fatalf("expected 2 parsed leads, got %d", len(parsed))
	}

	if parsed[0].Number != 1 {
		t.Fatalf("expected first lead number to be 1, got %d", parsed[0].Number)
	}
	if parsed[1].Number != 2 {
		t.Fatalf("expected second lead number to be 2, got %d", parsed[1].Number)
	}
}

func TestParseLeadsFields(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatalf("failed to create data dir: %v", err)
	}

	line := "3\t2026-06-05\tr/forhire\tu/devhire\tBuild me a SaaS\tapply\tnegotiating\t4.5/5\t$2000 project\t2026-06-15\t[3](reports/003-saas-2026-06-05.md)\n"
	if err := os.WriteFile(filepath.Join(dataDir, "leads.md"), []byte(line), 0o644); err != nil {
		t.Fatalf("failed to write leads.md: %v", err)
	}

	parsed := ParseLeads(tempDir)
	if len(parsed) != 1 {
		t.Fatalf("expected 1 lead, got %d", len(parsed))
	}

	lead := parsed[0]
	checks := map[string][2]string{
		"Source":       {lead.Source, "r/forhire"},
		"Poster":       {lead.Poster, "u/devhire"},
		"Gig":          {lead.Gig, "Build me a SaaS"},
		"Channel":      {lead.Channel, "apply"},
		"Status":       {lead.Status, "negotiating"},
		"Rate":         {lead.Rate, "$2000 project"},
		"NextFollowup": {lead.NextFollowup, "2026-06-15"},
		"ReportNumber": {lead.ReportNumber, "3"},
		"ReportPath":   {lead.ReportPath, "reports/003-saas-2026-06-05.md"},
	}
	for field, pair := range checks {
		if pair[0] != pair[1] {
			t.Errorf("%s = %q, want %q", field, pair[0], pair[1])
		}
	}
	if lead.Score != 4.5 {
		t.Errorf("Score = %v, want 4.5", lead.Score)
	}
}

func TestNormalizeStatus(t *testing.T) {
	cases := map[string]string{
		"new":         "new",
		"New":         "new",
		"contacted":   "contacted",
		"replied":     "replied",
		"negotiating": "negotiating",
		"won":         "won",
		"lost":        "lost",
		"dropped":     "dropped",
		"skip":        "dropped",
		"":            "new",
	}
	for raw, want := range cases {
		if got := NormalizeStatus(raw); got != want {
			t.Errorf("NormalizeStatus(%q) = %q, want %q", raw, got, want)
		}
	}
}
