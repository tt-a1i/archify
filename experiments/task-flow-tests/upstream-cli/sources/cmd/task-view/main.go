// Command task-view turns a coding agent's account of a finished task into
// review views, after checking that the account matches the repos exactly.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"

	"github.com/gtindo/task-view/internal/engine"
	"github.com/gtindo/task-view/internal/instructions"
	"github.com/gtindo/task-view/internal/langs"
	"github.com/gtindo/task-view/internal/render"
	"github.com/gtindo/task-view/internal/review"
)

// version is set at release time with -ldflags.
var version = "0.1.0-dev"

// exitUsage is the conventional exit code for a bad invocation. It equals
// review.ExitSchema, so scripts treat a bad invocation like an unusable
// review file.
const exitUsage = 2

// generatedDir is the folder, next to the review file, where open writes the
// page when --out is not given.
const generatedDir = "generated"

const usage = `task-view — review views for the change a coding agent made on a task

Usage:
  task-view validate <file> [--format text|json] [--scan-siblings]
  task-view open <file> [--out <path>] [--no-browser] [--scan-siblings]
  task-view gather [<path>[=<base>]...] [--base <rev>] [--tip <rev>] [--context <path>]...
                   [--review <file>] [--lines <n>] [--max-hunk-lines <n>] [--format text|json]
  task-view schema
  task-view languages
  task-view instructions
  task-view version

Exit codes (validate, open; gather uses 0, 2 and 3):
  0  schema valid, no contradicted or unresolved references
  1  at least one contradicted or unresolved reference
  2  schema invalid or file unreadable
  3  environment error (repo missing, not a Git repo, git not found)
`

const (
	validateUsage = "usage: task-view validate <file> [--format text|json] [--scan-siblings]\n"
	openUsage     = "usage: task-view open <file> [--out <path>] [--no-browser] [--scan-siblings]\n"

	scanSiblingsHelp = "also warn about dirty Git repos next to the listed repos"
	// --no-sibling-scan predates the opt-in --scan-siblings; it is still
	// accepted so existing scripts and agent instructions keep working.
	noSiblingScanHelp = "ignored: siblings are only scanned with --scan-siblings"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		emit(stderr, "%s", usage)

		return exitUsage
	}

	command, rest := args[0], args[1:]
	switch command {
	case "validate":
		return cmdValidate(rest, stdout, stderr)
	case "open":
		return cmdOpen(rest, stdout, stderr)
	case "gather":
		return cmdGather(rest, stdout, stderr)
	case "schema":
		emit(stdout, "%s", review.SchemaJSON)

		return review.ExitOK
	case "languages":
		writeLanguages(stdout)

		return review.ExitOK
	case "instructions":
		emit(stdout, "%s", instructions.Text)

		return review.ExitOK
	case "version", "--version", "-v":
		emit(stdout, "task-view %s\nschema versions: %s\n", version, joinInts(review.SupportedVersions))

		return review.ExitOK
	case "help", "--help", "-h":
		emit(stdout, "%s", usage)

		return review.ExitOK
	}

	emit(stderr, "unknown command %q\n\n%s", command, usage)

	return exitUsage
}

// emit writes CLI output. A failed write to stdout or stderr has nowhere left
// to be reported, and the exit code already carries the result, so the error
// is deliberately dropped in this one place.
func emit(out io.Writer, format string, args ...any) {
	_, _ = fmt.Fprintf(out, format, args...)
}

// writeLanguages lists each language's names, then its file extensions.
func writeLanguages(stdout io.Writer) {
	for _, language := range langs.All() {
		line := strings.Join(slices.Concat([]string{language.Name}, language.Aliases), ", ")
		if len(language.Extensions) > 0 {
			line += "\t" + strings.Join(language.Extensions, " ")
		}

		emit(stdout, "%s\n", line)
	}
}

// parseArgs splits positional args from flags so flags may follow the file:
// the flag package stops at the first positional arg, so parsing resumes
// after each one.
func parseArgs(flags *flag.FlagSet, args []string) ([]string, error) {
	var positional []string
	for len(args) > 0 {
		if err := flags.Parse(args); err != nil {
			return nil, err
		}

		args = flags.Args()
		if len(args) > 0 {
			positional = append(positional, args[0])
			args = args[1:]
		}
	}

	return positional, nil
}

func cmdValidate(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("validate", flag.ContinueOnError)
	flags.SetOutput(stderr)
	format := flags.String("format", "text", "output format: text or json")
	scanSiblings := flags.Bool("scan-siblings", false, scanSiblingsHelp)
	flags.Bool("no-sibling-scan", false, noSiblingScanHelp)

	positional, err := parseArgs(flags, args)
	if err != nil || len(positional) != 1 {
		emit(stderr, "%s", validateUsage)

		return exitUsage
	}

	reviewPath := positional[0]
	result := engine.Run(reviewPath, engine.Options{ScanSiblings: *scanSiblings})
	switch *format {
	case "json":
		writeJSON(stdout, result)
	case "text":
		emit(stdout, "%s", textReport(reviewPath, result))
	default:
		emit(stderr, "unknown format %q\n", *format)

		return exitUsage
	}

	return result.ExitCode
}

type validateOutput struct {
	Valid         bool             `json:"valid"`
	ExitCode      int              `json:"exitCode"`
	SchemaVersion int              `json:"schemaVersion"`
	Errors        []review.Finding `json:"errors"`
	Warnings      []review.Finding `json:"warnings"`
	Summary       engine.Summary   `json:"summary"`
}

func writeJSON(out io.Writer, result *engine.Engine) {
	errs, warnings := review.Split(result.Findings)
	output := validateOutput{
		Valid:         result.ExitCode == review.ExitOK,
		ExitCode:      result.ExitCode,
		SchemaVersion: review.SchemaVersion,
		Errors:        errs,
		Warnings:      warnings,
		Summary:       result.Summary,
	}

	encodeJSON(out, "  ", output)
}

// encodeJSON writes value as JSON for agents, each level indented by
// indent; an empty indent prints it on one line.
func encodeJSON(out io.Writer, indent string, value any) {
	encoder := json.NewEncoder(out)
	encoder.SetIndent("", indent)
	// Agents read hints and messages verbatim; keep <, > and & unescaped.
	encoder.SetEscapeHTML(false)
	// Like emit: a failed write to stdout has nowhere left to be reported.
	_ = encoder.Encode(value)
}

// textReport renders the human-readable validation report for the review
// file at reviewPath: a status line, the summary counts, then the errors and
// warnings.
func textReport(reviewPath string, result *engine.Engine) string {
	errs, warnings := review.Split(result.Findings)
	mark := "✓"
	if result.ExitCode != review.ExitOK {
		mark = "✗"
	}

	var report strings.Builder
	fmt.Fprintf(&report, "%s %s — exit %d: %d %s, %d %s\n", mark, reviewPath, result.ExitCode,
		len(errs), plural(len(errs), "error", "errors"),
		len(warnings), plural(len(warnings), "warning", "warnings"))

	summary := result.Summary
	fmt.Fprintf(&report, "  verified %d · contradicted %d · unresolved %d · agent statements %d\n",
		summary.Verified, summary.Contradicted, summary.Unresolved, summary.AgentStatements)

	writeFindings(&report, "errors", errs)
	writeFindings(&report, "warnings", warnings)

	return report.String()
}

// writeFindings appends a titled list of findings with their locations and
// hints, or nothing when there are none.
func writeFindings(report *strings.Builder, title string, findings []review.Finding) {
	if len(findings) == 0 {
		return
	}

	fmt.Fprintf(report, "\n%s\n", title)
	for _, finding := range findings {
		fmt.Fprintf(report, "  %-22s %s\n", finding.Code, findingLocation(finding))
		fmt.Fprintf(report, "    %s\n", finding.Message)
		if finding.Hint != "" {
			fmt.Fprintf(report, "    hint: %s\n", finding.Hint)
		}
	}
}

// findingLocation says where a finding points: its path in the review file,
// then the repo, file and line range, each part omitted when empty.
func findingLocation(finding review.Finding) string {
	var parts []string
	if finding.Path != "" {
		parts = append(parts, finding.Path)
	}

	where := finding.Repo
	if finding.File != "" {
		where += " " + fileLocation(finding.File, finding.Lines)
	}

	if where = strings.TrimSpace(where); where != "" {
		parts = append(parts, where)
	}

	return strings.Join(parts, "  ")
}

// fileLocation appends a line range to file as :line or :first-last; lines
// that do not hold a [first, last] pair are left out.
func fileLocation(file string, lines []int) string {
	isLineRange := len(lines) == 2
	if !isLineRange {
		return file
	}

	first, last := lines[0], lines[1]
	if first == last {
		return fmt.Sprintf("%s:%d", file, first)
	}

	return fmt.Sprintf("%s:%d-%d", file, first, last)
}

func cmdOpen(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("open", flag.ContinueOnError)
	flags.SetOutput(stderr)
	outPath := flags.String("out", "", "where to write the HTML file (default: generated/<name>.html next to the review file)")
	noBrowser := flags.Bool("no-browser", false, "write the page without opening it")
	scanSiblings := flags.Bool("scan-siblings", false, scanSiblingsHelp)
	flags.Bool("no-sibling-scan", false, noSiblingScanHelp)

	positional, err := parseArgs(flags, args)
	if err != nil || len(positional) != 1 {
		emit(stderr, "%s", openUsage)

		return exitUsage
	}

	reviewPath := positional[0]
	result := engine.Run(reviewPath, engine.Options{ScanSiblings: *scanSiblings})
	// A page built from a review that fails the schema or the environment
	// checks would mislead the reader, so open refuses to write one.
	if result.ExitCode >= review.ExitSchema {
		emit(stderr, "%s", textReport(reviewPath, result))
		emit(stderr, "\nno page generated: fix the errors above, then run open again\n")

		return result.ExitCode
	}

	page, err := render.HTML(result, version)
	if err != nil {
		emit(stderr, "cannot render page: %v\n", err)

		return review.ExitEnv
	}

	// Several review files can share .review/, one per task, so the default
	// page is named after its review file and kept apart in generated/.
	target := *outPath
	if target == "" {
		reviewName := strings.TrimSuffix(filepath.Base(reviewPath), filepath.Ext(reviewPath))
		target = filepath.Join(filepath.Dir(reviewPath), generatedDir, reviewName+".html")
	}

	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		emit(stderr, "cannot create %s: %v\n", filepath.Dir(target), err)

		return review.ExitEnv
	}

	if err := os.WriteFile(target, page, 0o644); err != nil {
		emit(stderr, "cannot write %s: %v\n", target, err)

		return review.ExitEnv
	}

	// Abs fails only when the working directory is gone; the page is already
	// written by then, so the message falls back to an empty path instead
	// of failing the command.
	absTarget, _ := filepath.Abs(target)

	// Contradicted or unresolved references still get a page, but the
	// reader should see why the exit code is not zero.
	if result.ExitCode != review.ExitOK {
		emit(stderr, "%s\n", textReport(reviewPath, result))
	}

	emit(stdout, "wrote %s\n", absTarget)
	if *noBrowser {
		return result.ExitCode
	}

	if err := openBrowser(absTarget); err != nil {
		emit(stderr, "cannot open browser: %v\n", err)
	}

	return result.ExitCode
}

// openBrowser opens path with the platform's default handler without
// waiting for it, so the command returns while the browser starts.
func openBrowser(path string) error {
	var opener *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		opener = exec.Command("open", path)
	case "windows":
		opener = exec.Command("rundll32", "url.dll,FileProtocolHandler", path)
	default:
		opener = exec.Command("xdg-open", path)
	}

	return opener.Start()
}

func plural(count int, one, many string) string {
	if count == 1 {
		return one
	}

	return many
}

func joinInts(numbers []int) string {
	texts := make([]string, 0, len(numbers))
	for _, number := range numbers {
		texts = append(texts, strconv.Itoa(number))
	}

	return strings.Join(texts, ", ")
}
