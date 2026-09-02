/*
 * resolveIsolateIds.js
 *
 * Populate isolate.isolate_id using the GenBank-derived fields:
 *
 *   gb_strain + gb_isolate  ->  [strain].[isolate]
 *   gb_strain only          ->  [strain]
 *   gb_isolate only         ->  [isolate]
 *
 * Existing non-empty isolate_id values are preserved.
 *
 * Run from project mode:
 *
 *   run script glue/build/resolveIsolateIds.js
 */

function normalise(value) {
    if (value === null || value === undefined) {
        return null;
    }

    var normalised = ("" + value).trim();

    if (normalised === "") {
        return null;
    }

    return normalised;
}


var isolates = glue.tableToObjects(

	glue.command([
		"list", "custom-table-row", "isolate",
		"id",
		"isolate_id",
		"gb_strain",
		"gb_isolate"
	])

);

var updatedCount = 0;
var preservedCount = 0;
var unresolvedCount = 0;


isolates.forEach(function(isolate) {

    var existingIsolateId = normalise(isolate.isolate_id);

    // Preserve an isolate_id that is already populated.
    if (existingIsolateId !== null) {
        preservedCount++;
        return;
    }

    var strain = normalise(isolate.gb_strain);
    var genbankIsolate = normalise(isolate.gb_isolate);
    var resolvedIsolateId = null;

    if (strain !== null && genbankIsolate !== null) {
        resolvedIsolateId = strain + "." + genbankIsolate;
    } else if (strain !== null) {
        resolvedIsolateId = strain;
    } else if (genbankIsolate !== null) {
        resolvedIsolateId = genbankIsolate;
    }

    if (resolvedIsolateId === null) {
        unresolvedCount++;
        return;
    }

	glue.inMode(
		"custom-table-row/isolate/" + isolate.id,
		function() {
			glue.command([
				"set", "field",
				"isolate_id", resolvedIsolateId
			]);
		}
	);
	
    updatedCount++;
});


glue.logInfo(
    "Resolved isolate IDs: " + updatedCount +
    " updated, " + preservedCount +
    " preserved, " + unresolvedCount +
    " unresolved"
);
