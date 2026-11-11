package render

import (
	"bytes"
	"embed"
	"encoding/json"
	"html"
	"strings"

	"github.com/gtindo/task-view/internal/engine"
)

//go:embed assets/index.html assets/app.css assets/app.js assets/vendor/cytoscape.min.js assets/vendor/elk.bundled.js assets/vendor/cytoscape-elk.js
var assets embed.FS

// asset panics on a missing file: assets are embedded at build time, so a
// failed read is a programming error, not a runtime condition.
func asset(name string) string {
	content, err := assets.ReadFile("assets/" + name)
	if err != nil {
		panic(err)
	}

	return string(content)
}

// script makes JavaScript safe to inline in a <script> element.
func script(js string) string {
	return strings.ReplaceAll(js, "</script", `<\/script`)
}

// HTML renders the self-contained review page for a finished engine run.
// version is the task-view version recorded in the page data.
func HTML(run *engine.Engine, version string) ([]byte, error) {
	data := build(run, version)

	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(true)
	if err := enc.Encode(data); err != nil {
		return nil, err
	}

	title := "Change review"
	if len(data.Repos) > 0 {
		var ids []string
		for _, repo := range data.Repos {
			ids = append(ids, repo.ID)
		}

		title += " · " + strings.Join(ids, ", ")
	}

	// The ";" between bundles keeps one bundle's unterminated last statement
	// from running into the next.
	vendor := script(asset("vendor/cytoscape.min.js")) + "\n;\n" +
		script(asset("vendor/elk.bundled.js")) + "\n;\n" +
		script(asset("vendor/cytoscape-elk.js"))

	page := asset("index.html")
	page = strings.Replace(page, "{{TITLE}}", html.EscapeString(title), 1)
	page = strings.Replace(page, "{{CSS}}", asset("app.css"), 1)
	page = strings.Replace(page, "{{DATA}}", buf.String(), 1)
	page = strings.Replace(page, "{{VENDOR}}", vendor, 1)
	page = strings.Replace(page, "{{APP}}", script(asset("app.js")), 1)

	return []byte(page), nil
}
