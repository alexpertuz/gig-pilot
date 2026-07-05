package data

// deriveLeadFields is a no-op for gig-ops: Rate, Channel, and NextFollowup
// are explicit tab-separated columns in leads.md, not derived from free text.
func deriveLeadFields(_ interface{}) {}
