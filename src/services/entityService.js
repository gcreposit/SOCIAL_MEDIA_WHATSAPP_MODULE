/**
 * Entity Service
 * Handles dynamic entity management and table generation
 */

class EntityService {
  constructor(databaseService) {
    this.dbService = databaseService;
    this.entities = {};
    this.tableDefinitions = {};
  }

  /**
   * Register a new entity with its schema definition
   * @param {string} entityName - Name of the entity (will be used as table name)
   * @param {Object} schema - Schema definition with field names and types
   * @param {Array} indexes - Optional array of fields to be indexed
   * @returns {boolean} - Success status
   */
  registerEntity(entityName, schema, indexes = []) {
    try {
      // Validate inputs
      if (!entityName || typeof entityName !== 'string') {
        throw new Error('Entity name must be a valid string');
      }
      
      if (!schema || typeof schema !== 'object') {
        throw new Error('Schema must be a valid object');
      }
      
      // Store entity definition
      this.entities[entityName] = {
        name: entityName,
        schema,
        indexes
      };
      
      // Generate SQL table definition
      const tableDefinition = this.generateTableDefinition(entityName, schema, indexes);
      this.tableDefinitions[entityName] = tableDefinition;
      
      console.log(`Entity '${entityName}' registered successfully`);
      return true;
    } catch (error) {
      console.error(`Error registering entity '${entityName}':`, error);
      return false;
    }
  }

  /**
   * Generate SQL table definition from schema
   * @param {string} entityName - Name of the entity
   * @param {Object} schema - Schema definition
   * @param {Array} indexes - Fields to be indexed
   * @returns {string} - SQL table definition
   */
  generateTableDefinition(entityName, schema, indexes) {
    // Start table creation SQL
    let sql = `CREATE TABLE IF NOT EXISTS ${entityName} (\n`;
    
    // Add id field as primary key
    sql += '  id INT AUTO_INCREMENT PRIMARY KEY,\n';
    
    // Add fields from schema
    const fields = [];
    for (const [fieldName, fieldType] of Object.entries(schema)) {
      fields.push(`  ${fieldName} ${this.mapTypeToSqlType(fieldType)}`);
    }
    
    // Add created_at timestamp
    fields.push('  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    
    // Join fields with commas
    sql += fields.join(',\n');
    
    // Add indexes if provided
    if (indexes && indexes.length > 0) {
      for (const indexField of indexes) {
        if (schema[indexField]) {
          sql += `,\n  INDEX idx_${indexField} (${indexField})`;
        }
      }
    }
    
    // Close table definition
    sql += '\n);';
    
    return sql;
  }

  /**
   * Map JavaScript/schema type to SQL type
   * @param {string} type - Schema type
   * @returns {string} - SQL type
   */
  mapTypeToSqlType(type) {
    switch (type.toLowerCase()) {
      case 'string':
        return 'VARCHAR(255)';
      case 'text':
        return 'TEXT';
      case 'longtext':
        return 'LONGTEXT';
      case 'int':
      case 'integer':
        return 'INT';
      case 'float':
      case 'double':
        return 'DOUBLE';
      case 'boolean':
        return 'BOOLEAN';
      case 'date':
        return 'DATE';
      case 'datetime':
        return 'DATETIME';
      case 'timestamp':
        return 'TIMESTAMP';
      case 'json':
        return 'JSON';
      default:
        return 'VARCHAR(255)';
    }
  }

  /**
   * Create all registered entity tables in the database
   * @returns {Promise<boolean>} - Success status
   */
  async createAllTables() {
    try {
      for (const [entityName, tableDefinition] of Object.entries(this.tableDefinitions)) {
        await this.dbService.pool.query(tableDefinition);
        console.log(`Table '${entityName}' created or verified successfully`);
      }
      return true;
    } catch (error) {
      console.error('Error creating entity tables:', error);
      return false;
    }
  }

  /**
   * Get all registered entities
   * @returns {Object} - Map of all registered entities
   */
  getAllEntities() {
    return this.entities;
  }

  /**
   * Get entity by name
   * @param {string} entityName - Name of the entity
   * @returns {Object|null} - Entity definition or null if not found
   */
  getEntity(entityName) {
    return this.entities[entityName] || null;
  }

  /**
   * Check if entity exists
   * @param {string} entityName - Name of the entity
   * @returns {boolean} - True if entity exists
   */
  entityExists(entityName) {
    return !!this.entities[entityName];
  }
}

module.exports = EntityService;