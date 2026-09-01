/*
 * riftRecogniseSegments.js
 *
 * Run riftSegmentRecogniser against selected sequences and populate:
 *
 *   rec_segment            recognised rift segment
 *   rec_oreientation  recognised sequence orientation
 */

//var whereClause = "segment = null";
var whereClause = null;

var results;

glue.inMode("/module/riftSegmentRecogniser", function() {

    if (whereClause) {
		results = glue.tableToObjects(glue.command([
			"recognise", "sequence",
			"-w", whereClause
		]));
    }
    else {
		results = glue.tableToObjects(glue.command([
			"recognise", "sequence", "-a"
		]));
    }
    
});

glue.log(
	"INFO",
	"Rift segment recogniser returned " + results.length + " results"
);


/*
 * Group results by query sequence.
 */

var resultsBySequence = {};

_.each(results, function(result) {

	var querySequenceId = result.querySequenceId;

	if (resultsBySequence[querySequenceId] == null) {
		resultsBySequence[querySequenceId] = [];
	}

	resultsBySequence[querySequenceId].push(result);
});


/*
 * Process each recognised sequence.
 */

var updated = 0;
var ambiguous = 0;

for (var querySequenceId in resultsBySequence) {

	if (!resultsBySequence.hasOwnProperty(querySequenceId)) {
		continue;
	}

	var sequenceResults = resultsBySequence[querySequenceId];

	var separatorIndex = querySequenceId.indexOf("/");

	if (separatorIndex < 0) {
		glue.log(
			"WARNING",
			"Could not parse query sequence ID: " + querySequenceId
		);
		continue;
	}

	var sourceName =
		querySequenceId.substring(0, separatorIndex);

	var sequenceID =
		querySequenceId.substring(separatorIndex + 1);

	/*
	 * Currently use the first category returned.
	 */

	var selectedResult = sequenceResults[0];

	var categoryId = selectedResult.categoryId;
	var direction = selectedResult.direction;

	if (sequenceResults.length > 1) {

		var categoryIds = [];

		_.each(sequenceResults, function(result) {
			categoryIds.push(result.categoryId);
		});

		glue.log(
			"WARNING",
			"Multiple recognition categories for " +
			querySequenceId + ": " +
			categoryIds.join(", ") +
			"; using first result: " + categoryId
		);

		ambiguous++;
	}

	glue.inMode(
		"/sequence/" + sourceName + "/" + sequenceID,
		function() {

			glue.command([
				"set", "field",
				"rec_segment", categoryId
			]);

			glue.command([
				"set", "field",
				"rec_orientation", direction
			]);
		}
	);

	updated++;
}


glue.log(
	"INFO",
	"Rift segment recognition complete: " +
	updated + " sequences updated; " +
	ambiguous + " had multiple recognition categories"
);