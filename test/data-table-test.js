var api = require('../'),
  assert = require('assert'),
  Node = api.Node,
  Utils = api.Utils,
  DataTable = api.data.DataTable,
  ShapefileTable = api.data.ShapefileTable;

describe('data-table.js', function () {

  describe('DataTable', function() {
    var data1;

    beforeEach(function() {
      data1 = [{'foo': 'goat', 'bar': 22}, {'foo': 'cat', 'bar': 0}];
    })

    describe("constructor", function() {
      it('initialize empty table', function() {
        var table = new DataTable();
        assert.deepEqual(table.getRecords(), []);
        assert.equal(table.size(), 0);
      })

      it('initialize n empty records', function() {
        var table = new DataTable(1);
        assert.deepEqual(table.getRecords(), [{}]);
        assert.equal(table.size(), 1);
        table = new DataTable(4);
        assert.deepEqual(table.getRecords(), [{}, {}, {}, {}]);
      })

      it('initialize from array of records', function() {
        var records = [{foo: 'a', foo: 'b'}];
        var table = new DataTable(records);
        assert.deepEqual(table.getRecords(), [{foo: 'a', foo: 'b'}]);
        assert.equal(table.getRecords(), records); // returns original data, not copy
      })
    })

    describe('#getRecords()', function() {
      it ("returns array of object records", function() {
        var table = new DataTable(data1);
        assert.deepEqual(table.getRecords(), data1);
      })
    })

    describe('#fieldExists()', function() {
      it ('identifies existing fields', function() {
        var table = new DataTable(data1);
        assert.ok(table.fieldExists('bar'))
        assert.ok(table.fieldExists('foo'))
      })

      it ('identifies nonexistent fields', function() {
        var table = new DataTable(data1);
        assert.equal(table.fieldExists('goo'), false)
        assert.equal(table.fieldExists(''), false)
      })
    })
  })

  describe('ShapefileTable', function() {
    function readDBF(relpath) {
      var path = Node.path.join(__dirname, relpath);
      return Node.readFile(path);
    }

    describe('#getRecords()', function() {
      it("converts dbf into object records", function() {
        var records = [{
            STATE_NAME: 'Oregon',
            FIPS: '41',
            STATE: 'OR',
            LAT: 43.94,
            LONG: -120.55
          }, {
            STATE_NAME: 'Washington',
            FIPS: '53',
            STATE: 'WA',
            LAT: 47.38,
            LONG: -120.00
          }];

        var table = new ShapefileTable(readDBF("test_data/two_states.dbf"));
        assert.deepEqual(JSON.stringify(table.getRecords()),
            JSON.stringify(records));
      })
    })

    describe('#fieldExists()', function() {
      it ('identifies existing fields', function() {
        var table = new ShapefileTable(readDBF("test_data/two_states.dbf"));
        assert.ok(table.fieldExists('LAT'))
        assert.ok(table.fieldExists('STATE_NAME'))
      })
    })
  })

});