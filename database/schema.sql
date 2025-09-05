-- Internal Task Management System Database Schema
-- This file contains all table definitions for internal item management

-- ================================
-- INTERNAL REMINDERS TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_reminders (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    reminder_datetime TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'snoozed')),
    repeat_type VARCHAR(20) CHECK (repeat_type IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INTERNAL EVENTS TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_events (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    event_datetime TIMESTAMP,
    end_datetime TIMESTAMP,
    location VARCHAR(255),
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'attended')),
    event_type VARCHAR(50) DEFAULT 'meeting',
    attendees JSONB DEFAULT '[]',
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INTERNAL TASKS TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_tasks (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    due_datetime TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'in_progress')),
    task_type VARCHAR(50) DEFAULT 'general',
    estimated_hours INTEGER,
    actual_hours INTEGER,
    tags JSONB DEFAULT '[]',
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INTERNAL NOTES TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_notes (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    note_datetime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
    note_type VARCHAR(50) DEFAULT 'general',
    tags JSONB DEFAULT '[]',
    is_pinned BOOLEAN DEFAULT FALSE,
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INTERNAL CONTACTS TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_contacts (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    contact_datetime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    contact_name VARCHAR(255),
    contact_phone VARCHAR(50),
    contact_email VARCHAR(255),
    contact_company VARCHAR(255),
    contact_type VARCHAR(50) DEFAULT 'general',
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INTERNAL ISSUES TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_issues (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    issue_datetime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'closed', 'in_progress')),
    severity VARCHAR(20) DEFAULT 'minor' CHECK (severity IN ('critical', 'major', 'minor', 'trivial')),
    issue_type VARCHAR(50) DEFAULT 'general',
    assigned_to VARCHAR(255),
    resolution TEXT,
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INTERNAL LEARNING ITEMS TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_learning_items (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    learning_datetime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'in_progress')),
    learning_type VARCHAR(50) DEFAULT 'general',
    resource_url VARCHAR(500),
    estimated_duration INTEGER, -- in minutes
    completion_percentage INTEGER DEFAULT 0,
    tags JSONB DEFAULT '[]',
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INTERNAL FINANCE ITEMS TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_finance_items (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    finance_datetime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    finance_type VARCHAR(50) DEFAULT 'expense',
    amount DECIMAL(12,2),
    currency VARCHAR(10) DEFAULT 'USD',
    due_date TIMESTAMP,
    category VARCHAR(100),
    account VARCHAR(100),
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INTERNAL HEALTH ITEMS TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_health_items (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    health_datetime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    health_type VARCHAR(50) DEFAULT 'general',
    appointment_datetime TIMESTAMP,
    doctor_name VARCHAR(255),
    location VARCHAR(255),
    symptoms JSONB DEFAULT '[]',
    medications JSONB DEFAULT '[]',
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INTERNAL SHOPPING ITEMS TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_shopping_items (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    shopping_datetime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    item_name VARCHAR(255),
    quantity INTEGER DEFAULT 1,
    estimated_price DECIMAL(10,2),
    store VARCHAR(255),
    category VARCHAR(100),
    shopping_list_id INTEGER,
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INTERNAL TRAVEL ITEMS TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_travel_items (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    travel_datetime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    travel_type VARCHAR(50) DEFAULT 'general',
    departure_date TIMESTAMP,
    return_date TIMESTAMP,
    destination VARCHAR(255),
    departure_location VARCHAR(255),
    booking_reference VARCHAR(100),
    traveler_details JSONB DEFAULT '{}',
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INTERNAL CREATIVE ITEMS TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_creative_items (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    creative_datetime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'in_progress')),
    creative_type VARCHAR(50) DEFAULT 'general',
    project_name VARCHAR(255),
    deadline TIMESTAMP,
    inspiration_links JSONB DEFAULT '[]',
    tags JSONB DEFAULT '[]',
    progress_notes TEXT,
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INTERNAL ADMIN ITEMS TABLE
-- ================================
CREATE TABLE IF NOT EXISTS internal_admin_items (
    id SERIAL PRIMARY KEY,
    action_id VARCHAR(255) REFERENCES ai_actions(action_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    admin_datetime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    admin_type VARCHAR(50) DEFAULT 'general',
    document_reference VARCHAR(255),
    deadline TIMESTAMP,
    department VARCHAR(100),
    approval_required BOOLEAN DEFAULT FALSE,
    approval_status VARCHAR(50),
    created_from VARCHAR(50) DEFAULT 'whatsapp',
    user_id INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================
-- INDEXES FOR PERFORMANCE
-- ================================
-- User-based indexes
CREATE INDEX IF NOT EXISTS idx_internal_reminders_user_id ON internal_reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_events_user_id ON internal_events(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_user_id ON internal_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_notes_user_id ON internal_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_contacts_user_id ON internal_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_issues_user_id ON internal_issues(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_learning_items_user_id ON internal_learning_items(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_finance_items_user_id ON internal_finance_items(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_health_items_user_id ON internal_health_items(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_shopping_items_user_id ON internal_shopping_items(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_travel_items_user_id ON internal_travel_items(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_creative_items_user_id ON internal_creative_items(user_id);
CREATE INDEX IF NOT EXISTS idx_internal_admin_items_user_id ON internal_admin_items(user_id);

-- Status-based indexes
CREATE INDEX IF NOT EXISTS idx_internal_reminders_status ON internal_reminders(status);
CREATE INDEX IF NOT EXISTS idx_internal_events_status ON internal_events(status);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_status ON internal_tasks(status);
CREATE INDEX IF NOT EXISTS idx_internal_notes_status ON internal_notes(status);
CREATE INDEX IF NOT EXISTS idx_internal_contacts_status ON internal_contacts(status);
CREATE INDEX IF NOT EXISTS idx_internal_issues_status ON internal_issues(status);
CREATE INDEX IF NOT EXISTS idx_internal_learning_items_status ON internal_learning_items(status);
CREATE INDEX IF NOT EXISTS idx_internal_finance_items_status ON internal_finance_items(status);
CREATE INDEX IF NOT EXISTS idx_internal_health_items_status ON internal_health_items(status);
CREATE INDEX IF NOT EXISTS idx_internal_shopping_items_status ON internal_shopping_items(status);
CREATE INDEX IF NOT EXISTS idx_internal_travel_items_status ON internal_travel_items(status);
CREATE INDEX IF NOT EXISTS idx_internal_creative_items_status ON internal_creative_items(status);
CREATE INDEX IF NOT EXISTS idx_internal_admin_items_status ON internal_admin_items(status);

-- Datetime indexes for time-based queries
CREATE INDEX IF NOT EXISTS idx_internal_reminders_datetime ON internal_reminders(reminder_datetime);
CREATE INDEX IF NOT EXISTS idx_internal_events_datetime ON internal_events(event_datetime);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_due_datetime ON internal_tasks(due_datetime);
CREATE INDEX IF NOT EXISTS idx_internal_health_appointment_datetime ON internal_health_items(appointment_datetime);
CREATE INDEX IF NOT EXISTS idx_internal_travel_departure_date ON internal_travel_items(departure_date);
CREATE INDEX IF NOT EXISTS idx_internal_creative_deadline ON internal_creative_items(deadline);
CREATE INDEX IF NOT EXISTS idx_internal_admin_deadline ON internal_admin_items(deadline);

-- Priority indexes
CREATE INDEX IF NOT EXISTS idx_internal_reminders_priority ON internal_reminders(priority);
CREATE INDEX IF NOT EXISTS idx_internal_events_priority ON internal_events(priority);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_priority ON internal_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_internal_issues_priority ON internal_issues(priority);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_internal_reminders_user_status ON internal_reminders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_internal_events_user_status ON internal_events(user_id, status);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_user_status ON internal_tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_internal_notes_user_status ON internal_notes(user_id, status);
CREATE INDEX IF NOT EXISTS idx_internal_issues_user_status ON internal_issues(user_id, status);

-- Action ID indexes for relationship queries
CREATE INDEX IF NOT EXISTS idx_internal_reminders_action_id ON internal_reminders(action_id);
CREATE INDEX IF NOT EXISTS idx_internal_events_action_id ON internal_events(action_id);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_action_id ON internal_tasks(action_id);
CREATE INDEX IF NOT EXISTS idx_internal_notes_action_id ON internal_notes(action_id);
CREATE INDEX IF NOT EXISTS idx_internal_contacts_action_id ON internal_contacts(action_id);
CREATE INDEX IF NOT EXISTS idx_internal_issues_action_id ON internal_issues(action_id);
CREATE INDEX IF NOT EXISTS idx_internal_learning_items_action_id ON internal_learning_items(action_id);
CREATE INDEX IF NOT EXISTS idx_internal_finance_items_action_id ON internal_finance_items(action_id);
CREATE INDEX IF NOT EXISTS idx_internal_health_items_action_id ON internal_health_items(action_id);
CREATE INDEX IF NOT EXISTS idx_internal_shopping_items_action_id ON internal_shopping_items(action_id);
CREATE INDEX IF NOT EXISTS idx_internal_travel_items_action_id ON internal_travel_items(action_id);
CREATE INDEX IF NOT EXISTS idx_internal_creative_items_action_id ON internal_creative_items(action_id);
CREATE INDEX IF NOT EXISTS idx_internal_admin_items_action_id ON internal_admin_items(action_id);