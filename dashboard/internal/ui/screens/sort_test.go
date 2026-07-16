package screens

import (
	"testing"

	"github.com/santifer/gig-pilot/dashboard/internal/model"
	"github.com/santifer/gig-pilot/dashboard/internal/theme"
)

func TestSortCycleIncludesGigColumns(t *testing.T) {
	want := map[string]bool{sortChannel: false, sortRate: false, sortFollowup: false}
	for _, s := range sortCycle {
		if _, ok := want[s]; ok {
			want[s] = true
		}
	}
	for mode, found := range want {
		if !found {
			t.Errorf("sort cycle is missing %q", mode)
		}
	}
}

func TestSortByRateChannelAndFollowup(t *testing.T) {
	leads := []model.Lead{
		{Source: "r/forhire", Status: "contacted", Rate: "$75/hr", Channel: "dm", NextFollowup: "2026-06-10"},
		{Source: "remoteok", Status: "new", Rate: "", Channel: "apply", NextFollowup: ""},
		{Source: "r/jobbit", Status: "negotiating", Rate: "$100/hr", Channel: "email", NextFollowup: "2026-06-05"},
		{Source: "r/slavelabour", Status: "replied", Rate: "$50/hr", Channel: "comment", NextFollowup: "2026-06-08"},
	}

	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), leads, model.PipelineMetrics{Total: len(leads)}, "..", 120, 40)
	pm.viewMode = "flat"

	// Rate sort: lexicographic descending (rate strings are text)
	pm.sortMode = sortRate
	pm.applyFilterAndSort()
	if len(pm.filtered) < 2 {
		t.Fatalf("expected filtered leads, got %d", len(pm.filtered))
	}

	// Channel sort: alphabetical ascending
	pm.sortMode = sortChannel
	pm.applyFilterAndSort()
	// "apply" < "comment" < "dm" < "email"
	wantChannels := []string{"apply", "comment", "dm", "email"}
	for i, want := range wantChannels {
		if pm.filtered[i].Channel != want {
			t.Fatalf("channel sort: position %d = %q, want %q", i, pm.filtered[i].Channel, want)
		}
	}

	// Followup sort: soonest first; empty sinks to bottom
	pm.sortMode = sortFollowup
	pm.applyFilterAndSort()
	if pm.filtered[0].NextFollowup != "2026-06-05" {
		t.Fatalf("followup sort: expected 2026-06-05 first, got %q", pm.filtered[0].NextFollowup)
	}
	if pm.filtered[len(pm.filtered)-1].NextFollowup != "" {
		t.Fatalf("followup sort: expected empty last, got %q", pm.filtered[len(pm.filtered)-1].NextFollowup)
	}
}
