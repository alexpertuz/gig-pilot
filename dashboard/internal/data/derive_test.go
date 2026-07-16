package data

import "testing"

// derive.go is a no-op for gig-pilot — Rate, Channel, and NextFollowup are
// explicit columns in leads.md, not derived from free text.

func TestDeriveLeadFieldsIsNoOp(t *testing.T) {
	deriveLeadFields(nil)
}
