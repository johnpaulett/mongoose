
var mongo = require('mongodb/'),
    object = require('./utils/object'),
    Model = require('./model').Model,
    EventEmitter = require('events').EventEmitter,
    sys = require('sys'),
    instances = 0,

    Storage = exports.Storage = function(instance,conn,options){

      this.id = ++instances;
      this.conn = conn;
      this.mongoose = instance;

      this.db = this.getDatabaseInstance(options);

      EventEmitter.call(this);
      var self = this;
      this.db.open(function(err,connection){
        if(err) self.emit('error',err);
        self.loaded = (err) ? false : connection;
        self.dequeue();
      });

      return this;
    };

    Storage.prototype = {
  
        loaded : false,
        halted : false,
        collections : {},
        buffer : [],
  
        getDatabaseInstance : function(options){
          var conn = this.conn,
              options = options || {};

          if(conn[0].type != 'mongodb'){
            this.emit('error','Must use mongodb:// in uri connection string');
            return false;
          }
    
          if(conn.length == 1){ // simple (single server)
              return new mongo.Db(conn[0].db, new mongo.Server(conn[0].host, (conn[0].port || 27017), options),{});
          }
          else if(conn.length == 2) // server pair
              return new mongo.Db(conn[0].db, new mongo.ServerPair(
                new mongo.Server(conn[0].host, conn[0].port || 27017, options),
                new mongo.Server(conn[1].host, conn[1].port || 27017, options)
              ));
          else // cluster (master and multiple slaves)
            return new mongo.Db(conn[0].db, new mongo.ServerCluster(
              conn.map(function(server){
                return new mongo.Server(server.host, server.port || 27017, options);
              })
            ));          
        },
  
        dequeue : function(){
          if(!this.buffer.length || !this.loaded || this.halted) return;
    
          var op = this.buffer.shift();
          if(op.name == 'collection'){
            var self = this;
            op.args.push(function(err,aCollection){
              if(err) self.emit('error',err);
              else {
                self.collections[aCollection.collectionName] = aCollection;
                op.callback(aCollection);
              }
            }); 
          }
          else op.args.push(op.callback || function(){});
    
          this.db[op.name].apply(this.db,op.args);
          this.dequeue();
        },
        
        static : function(model){
          return this.mongoose.get(model,this);
        },
        
        use : function(collection){
          return this.mongoose.get(collection,this,true);
        },
        
        noSchema : function(collection){
          return Model.load(collection, this, {noSchema : true});
        },

        collection : function(){ return this._cmd('collection',Array.prototype.slice.call(arguments,0)); },
        close : function(){ return this._cmd('close', Array.prototype.slice.call(arguments,0)); },
        dropCollection : function(){ return this._cmd('dropCollection', Array.prototype.slice.call(arguments,0)); },
        
        _cmd : function(cmd,args){
          var operation = { 
                name : cmd,
                callback : (args.length) ? ( (args[args.length-1] instanceof Function) ? args.pop() : null ) : null,
                args : args 
              };
        
          this.buffer.push(operation);
          this.dequeue();
        },
  
        halt : function(){
          this.halted = true;
          return this;
        },
  
        resume : function(){
          this.halted = false;
          this.dequeue();
          return this;
        },
  
        clear : function(){
          this.buffer = [];
          return this;
        },
        
        close : function(){
          this.halt();
          this.clear();
          for(col in this.collections){
            this.collections[col].close(function(){});
            delete this.collections[col];
          }
          this.db.close(function(){});
          delete this.db;
          this.loaded = false;
        }
    };

    Storage.prototype.loadModel = Storage.prototype.bindModel; // alias
    object.merge(Storage.prototype, EventEmitter.prototype);
