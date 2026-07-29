// Delete patent-related sequences and link all remaining sequences to isolates.
//
// Input file columns:
//   sequenceID
//   patent_related
//
// Assumes:
// - tabularUtilityTab module exists
// - sequences are in source ncbi-core-rift
// - isolate custom table exists
// - sequence -> isolate custom-table link exists

var INPUT_FILE = "tabular/patent_related.tsv";
var SOURCE_NAME = "ncbi-core-rift";
var DRY_RUN = false;

function log(msg) {
	glue.logInfo(msg);
}

function norm(value) {
	if(value == null) {
		return null;
	}
	var s = ("" + value).trim();
	if(s === "") {
		return null;
	}
	return s;
}

function isTrue(value) {
	var s = norm(value);
	if(s == null) {
		return false;
	}
	return s.toLowerCase() === "true";
}

function escapeQuotes(value) {
	return value.replace(/'/g, "\\'");
}

// Load the patent-related sequence table.
var patentRows;

glue.inMode("module/tabularUtilityTab", function() {
	patentRows = glue.tableToObjects(
		glue.command(["load-tabular", INPUT_FILE])
	);
});

log("Loaded " + patentRows.length + " rows from " + INPUT_FILE);

// Build a lookup containing sequences marked patent_related = true.
var patentRelated = {};

_.each(patentRows, function(row) {

	var sequenceId = norm(row["sequenceID"]);
	var patentFlag = row["patent_related"];

	if(sequenceId == null) {
		log("Skipping row with missing sequenceID: " + JSON.stringify(row));
		return;
	}

	if(isTrue(patentFlag)) {
		patentRelated[sequenceId] = true;
	}
});

log(
	"Loaded " +
	Object.keys(patentRelated).length +
	" patent-related sequence IDs"
);

// List sequences currently present in ncbi-core-rift.
var listSeqResult = glue.command([
	"list", "sequence",
	"-w", "source.name = '" + escapeQuotes(SOURCE_NAME) + "'"
]);

var seqIds = glue.getTableColumn(listSeqResult, "sequenceID");

var deletedCount = 0;
var linkedCount = 0;

// Process every sequence in the source.
_.each(seqIds, function(seqId) {

	if(patentRelated[seqId] === true) {

		if(!DRY_RUN) {
			glue.command([
				"delete", "sequence",
				"-w",
				"source.name = '" + escapeQuotes(SOURCE_NAME) +
				"' and sequenceID = '" + escapeQuotes(seqId) + "'"
			]);
		}

		deletedCount++;
		log("Deleted patent-related sequence: " + seqId);

		return;
	}

	// Create an isolate row using the sequence ID as the row ID.
	if(!DRY_RUN) {
		glue.command([
			"create", "custom-table-row",
			"isolate", seqId
		]);

		// Link the sequence to the isolate row.
		glue.inMode("sequence/" + SOURCE_NAME + "/" + seqId, function() {
			glue.command([
				"set", "link-target",
				"isolate",
				"custom-table-row/isolate/" + seqId
			]);
		});
	}

	linkedCount++;
	log("Linked sequence to isolate: " + seqId);
});

log("----- SUMMARY -----");
log("Patent-related sequences deleted: " + deletedCount);
log("Sequences linked to isolates: " + linkedCount);