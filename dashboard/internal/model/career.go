package model

// Lead represents a single freelance gig lead from the tracker.
type Lead struct {
	Number       int
	Date         string // first seen (ISO date)
	Source       string // r/forhire, remoteok, etc.
	Poster       string // Reddit username or poster handle
	Gig          string // title/brief description
	Channel      string // dm/email/comment/apply
	Status       string // new/contacted/replied/negotiating/won/lost/dropped
	Score        float64
	ScoreRaw     string
	Rate         string // agreed or proposed rate
	NextFollowup string // ISO date for next follow-up
	ReportPath   string
	ReportNumber string
	JobURL       string
	// Enrichment (lazy loaded from report)
	Archetype string
	TlDr      string
}

// PipelineMetrics holds aggregate stats for the pipeline dashboard.
type PipelineMetrics struct {
	Total      int
	ByStatus   map[string]int
	AvgScore   float64
	TopScore   float64
	Actionable int
}

// ProgressMetrics holds gig pipeline progress analytics.
type ProgressMetrics struct {
	// Funnel
	FunnelStages []FunnelStage

	// Score distribution
	ScoreBuckets []ScoreBucket

	// Timeline (weekly activity)
	WeeklyActivity []WeekActivity

	// Rates (relative to contacted)
	ReplyRate      float64
	NegotiateRate  float64
	WinRate        float64

	// Averages
	AvgScore    float64
	TopScore    float64
	TotalWon    int
	ActiveLeads int // not lost/dropped
}

// FunnelStage represents one stage of the gig funnel.
type FunnelStage struct {
	Label string
	Count int
	Pct   float64
}

// ScoreBucket represents a score range and its count.
type ScoreBucket struct {
	Label string
	Count int
}

// WeekActivity represents lead activity for a given ISO week.
type WeekActivity struct {
	Week  string
	Count int
}
