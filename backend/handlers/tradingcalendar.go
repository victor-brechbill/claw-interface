package handlers

import (
	"time"
)

// TradingCalendar handles NYSE trading day logic
type TradingCalendar struct {
	holidays map[string]bool
	location *time.Location
}

// NewTradingCalendar creates a new trading calendar with NYSE holidays for 2026
func NewTradingCalendar() *TradingCalendar {
	et, _ := time.LoadLocation("America/New_York")

	// NYSE 2026 holidays
	holidays := map[string]bool{
		"2026-01-01": true, // New Year's Day (Wed)
		"2026-01-20": true, // MLK Day (Mon)
		"2026-02-17": true, // Presidents' Day (Mon)
		"2026-04-03": true, // Good Friday (Fri)
		"2026-05-25": true, // Memorial Day (Mon)
		"2026-06-19": true, // Juneteenth (Fri)
		"2026-07-03": true, // Independence Day observed (Fri)
		"2026-09-07": true, // Labor Day (Mon)
		"2026-11-26": true, // Thanksgiving (Thu)
		"2026-12-25": true, // Christmas (Fri)
	}

	return &TradingCalendar{
		holidays: holidays,
		location: et,
	}
}

// IsTradingDay returns true if the given date is a trading day (not weekend or holiday)
func (tc *TradingCalendar) IsTradingDay(date time.Time) bool {
	// Convert to ET timezone
	dateET := date.In(tc.location)

	// Check if weekend
	if dateET.Weekday() == time.Saturday || dateET.Weekday() == time.Sunday {
		return false
	}

	// Check if holiday
	dateStr := dateET.Format("2006-01-02")
	if tc.holidays[dateStr] {
		return false
	}

	return true
}

// IsMarketOpen returns true if the market is currently open (9:30 AM - 4:00 PM ET on trading days)
func (tc *TradingCalendar) IsMarketOpen(t time.Time) bool {
	// Convert to ET timezone
	et := t.In(tc.location)

	// Check if it's a trading day first
	if !tc.IsTradingDay(et) {
		return false
	}

	// Market hours: 9:30 AM - 4:00 PM ET
	marketOpen := time.Date(et.Year(), et.Month(), et.Day(), 9, 30, 0, 0, tc.location)
	marketClose := time.Date(et.Year(), et.Month(), et.Day(), 16, 0, 0, 0, tc.location)

	return et.After(marketOpen) && et.Before(marketClose)
}

// GetCalculationDate determines what date to use for calculations
// If market is open, use today. If closed, use most recent trading day
func (tc *TradingCalendar) GetCalculationDate(t time.Time) time.Time {
	if tc.IsMarketOpen(t) {
		return t.In(tc.location)
	}

	// Market is closed, find most recent trading day
	return tc.PreviousTradingDay(t.In(tc.location).AddDate(0, 0, 1)) // Add 1 day to include today in search
}

// PreviousTradingDay returns the previous trading day before the given date
func (tc *TradingCalendar) PreviousTradingDay(date time.Time) time.Time {
	// Convert to ET timezone and start from the day before
	current := date.In(tc.location).AddDate(0, 0, -1)

	// Keep going back until we find a trading day
	for !tc.IsTradingDay(current) {
		current = current.AddDate(0, 0, -1)
	}

	return current
}

// PreviousWeekClose returns the close date for the previous week
func (tc *TradingCalendar) PreviousWeekClose(t time.Time) time.Time {
	current := t.In(tc.location)

	// Determine if we're in a weekend period
	if tc.IsWeekend(current) {
		// Weekend: Find the Friday before the most recent Friday
		thisWeekClose := tc.findMostRecentTradingDay(current)
		return tc.findPreviousFriday(thisWeekClose.AddDate(0, 0, -1))
	} else {
		// Mid-week: Find most recent Friday before today
		return tc.findPreviousFriday(current.AddDate(0, 0, -1))
	}
}

// IsWeekend returns true if we're between the last trading day close and next week's open
func (tc *TradingCalendar) IsWeekend(t time.Time) bool {
	et := t.In(tc.location)

	// If it's literally Saturday or Sunday, it's weekend
	if et.Weekday() == time.Saturday || et.Weekday() == time.Sunday {
		return true
	}

	// Check if it's after market close on the last trading day of the week
	if et.Weekday() == time.Friday && !tc.IsTradingDay(et) {
		// Friday is a holiday, check if we're past Thursday's close
		lastTradingDay := tc.PreviousTradingDay(et)
		marketClose := time.Date(lastTradingDay.Year(), lastTradingDay.Month(), lastTradingDay.Day(), 16, 0, 0, 0, tc.location)

		// If we're after the close of the last trading day of the week, it's weekend
		if time.Now().In(tc.location).After(marketClose) {
			return true
		}
	} else if et.Weekday() == time.Friday && tc.IsTradingDay(et) {
		// Friday is a trading day, check if we're after Friday's close
		marketClose := time.Date(et.Year(), et.Month(), et.Day(), 16, 0, 0, 0, tc.location)

		if et.After(marketClose) {
			return true
		}
	}

	return false
}

// findMostRecentTradingDay finds the most recent trading day (working backwards from given date)
func (tc *TradingCalendar) findMostRecentTradingDay(date time.Time) time.Time {
	current := date.In(tc.location)

	for !tc.IsTradingDay(current) {
		current = current.AddDate(0, 0, -1)
	}

	return current
}

// findPreviousFriday finds the most recent Friday before the given date (that was a trading day)
func (tc *TradingCalendar) findPreviousFriday(date time.Time) time.Time {
	current := date.In(tc.location)

	// Go back until we find a Friday
	for current.Weekday() != time.Friday {
		current = current.AddDate(0, 0, -1)
	}

	// If this Friday wasn't a trading day, find the previous trading day
	for !tc.IsTradingDay(current) {
		current = current.AddDate(0, 0, -1)
	}

	return current
}
