export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          actor_id: string | null
          employee_id: string | null
          event_type: string
          id: string
          message: string
          metadata: Json
          occurred_at: string
        }
        Insert: {
          actor_id?: string | null
          employee_id?: string | null
          event_type: string
          id?: string
          message: string
          metadata?: Json
          occurred_at?: string
        }
        Update: {
          actor_id?: string | null
          employee_id?: string | null
          event_type?: string
          id?: string
          message?: string
          metadata?: Json
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_assignments: {
        Row: {
          asset_id: string
          assigned_by: string | null
          assigned_date: string
          created_at: string
          employee_code: string | null
          employee_id: string | null
          id: string
          person_name: string | null
          remarks: string | null
          returned: boolean
          returned_date: string | null
        }
        Insert: {
          asset_id: string
          assigned_by?: string | null
          assigned_date?: string
          created_at?: string
          employee_code?: string | null
          employee_id?: string | null
          id?: string
          person_name?: string | null
          remarks?: string | null
          returned?: boolean
          returned_date?: string | null
        }
        Update: {
          asset_id?: string
          assigned_by?: string | null
          assigned_date?: string
          created_at?: string
          employee_code?: string | null
          employee_id?: string | null
          id?: string
          person_name?: string | null
          remarks?: string | null
          returned?: boolean
          returned_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_assignments_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_maintenance: {
        Row: {
          asset_id: string
          cost: number | null
          created_at: string
          created_by: string | null
          id: string
          maint_date: string
          maint_type: string | null
          next_due: string | null
          notes: string | null
          vendor: string | null
        }
        Insert: {
          asset_id: string
          cost?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          maint_date?: string
          maint_type?: string | null
          next_due?: string | null
          notes?: string | null
          vendor?: string | null
        }
        Update: {
          asset_id?: string
          cost?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          maint_date?: string
          maint_type?: string | null
          next_due?: string | null
          notes?: string | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_maintenance_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          antivirus: string | null
          asset_category: string | null
          assigned_by: string | null
          assigned_date: string | null
          assigned_employee_code: string | null
          assigned_employee_id: string | null
          assigned_person_name: string | null
          brand: string | null
          created_at: string
          desktop_name: string
          device_id: string | null
          graphics_card: string | null
          id: string
          model_no: string | null
          processor: string | null
          product_id: string | null
          ram: string | null
          serial_no: string | null
          storage: string | null
          updated_at: string
          warranty_renew: string | null
          warranty_upto: string | null
        }
        Insert: {
          antivirus?: string | null
          asset_category?: string | null
          assigned_by?: string | null
          assigned_date?: string | null
          assigned_employee_code?: string | null
          assigned_employee_id?: string | null
          assigned_person_name?: string | null
          brand?: string | null
          created_at?: string
          desktop_name: string
          device_id?: string | null
          graphics_card?: string | null
          id?: string
          model_no?: string | null
          processor?: string | null
          product_id?: string | null
          ram?: string | null
          serial_no?: string | null
          storage?: string | null
          updated_at?: string
          warranty_renew?: string | null
          warranty_upto?: string | null
        }
        Update: {
          antivirus?: string | null
          asset_category?: string | null
          assigned_by?: string | null
          assigned_date?: string | null
          assigned_employee_code?: string | null
          assigned_employee_id?: string | null
          assigned_person_name?: string | null
          brand?: string | null
          created_at?: string
          desktop_name?: string
          device_id?: string | null
          graphics_card?: string | null
          id?: string
          model_no?: string | null
          processor?: string | null
          product_id?: string | null
          ram?: string | null
          serial_no?: string | null
          storage?: string | null
          updated_at?: string
          warranty_renew?: string | null
          warranty_upto?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_assigned_employee_id_fkey"
            columns: ["assigned_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_days: {
        Row: {
          corrected_by: string | null
          correction_reason: string | null
          created_at: string
          employee_id: string
          id: string
          is_corrected: boolean
          punch_in: string | null
          punch_out: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at: string
          work_date: string
          worked_minutes: number
        }
        Insert: {
          corrected_by?: string | null
          correction_reason?: string | null
          created_at?: string
          employee_id: string
          id?: string
          is_corrected?: boolean
          punch_in?: string | null
          punch_out?: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
          work_date: string
          worked_minutes?: number
        }
        Update: {
          corrected_by?: string | null
          correction_reason?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          is_corrected?: boolean
          punch_in?: string | null
          punch_out?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
          work_date?: string
          worked_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "attendance_days_corrected_by_fkey"
            columns: ["corrected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_days_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          created_at: string
          geofence_lat: number | null
          geofence_lng: number | null
          geofence_radius_m: number
          id: string
          name: string
          state: Database["public"]["Enums"]["indian_state"]
        }
        Insert: {
          address?: string | null
          created_at?: string
          geofence_lat?: number | null
          geofence_lng?: number | null
          geofence_radius_m?: number
          id?: string
          name: string
          state: Database["public"]["Enums"]["indian_state"]
        }
        Update: {
          address?: string | null
          created_at?: string
          geofence_lat?: number | null
          geofence_lng?: number | null
          geofence_radius_m?: number
          id?: string
          name?: string
          state?: Database["public"]["Enums"]["indian_state"]
        }
        Relationships: []
      }
      comp_offs: {
        Row: {
          created_at: string
          earned_date: string
          employee_id: string
          granted_by: string | null
          id: string
          request_id: string | null
          status: Database["public"]["Enums"]["comp_off_status"]
          used_date: string | null
        }
        Insert: {
          created_at?: string
          earned_date: string
          employee_id: string
          granted_by?: string | null
          id?: string
          request_id?: string | null
          status?: Database["public"]["Enums"]["comp_off_status"]
          used_date?: string | null
        }
        Update: {
          created_at?: string
          earned_date?: string
          employee_id?: string
          granted_by?: string | null
          id?: string
          request_id?: string | null
          status?: Database["public"]["Enums"]["comp_off_status"]
          used_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comp_offs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comp_offs_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comp_offs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_run_log: {
        Row: {
          detail: string | null
          id: string
          job: string
          ran_at: string
          run_key: string
        }
        Insert: {
          detail?: string | null
          id?: string
          job: string
          ran_at?: string
          run_key: string
        }
        Update: {
          detail?: string | null
          id?: string
          job?: string
          ran_at?: string
          run_key?: string
        }
        Relationships: []
      }
      departments: {
        Row: {
          branch_id: string | null
          id: string
          name: string
        }
        Insert: {
          branch_id?: string | null
          id?: string
          name: string
        }
        Update: {
          branch_id?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          aadhaar: string | null
          bank_account_number: string | null
          bank_ifsc: string | null
          bank_name: string | null
          basic_da: number
          branch_id: string
          code: string
          created_at: string
          date_of_birth: string | null
          date_of_joining: string
          department_id: string | null
          designation: string | null
          email: string | null
          email_official: string | null
          email_personal: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relation: string | null
          esic_number: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"]
          gross_monthly: number
          hra: number
          id: string
          mobile_official: string | null
          mobile_personal: string | null
          pan: string | null
          pf_uan: string | null
          special_allowance: number
          status: Database["public"]["Enums"]["employee_status"]
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          aadhaar?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          basic_da?: number
          branch_id: string
          code: string
          created_at?: string
          date_of_birth?: string | null
          date_of_joining: string
          department_id?: string | null
          designation?: string | null
          email?: string | null
          email_official?: string | null
          email_personal?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          esic_number?: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"]
          gross_monthly?: number
          hra?: number
          id?: string
          mobile_official?: string | null
          mobile_personal?: string | null
          pan?: string | null
          pf_uan?: string | null
          special_allowance?: number
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          aadhaar?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          basic_da?: number
          branch_id?: string
          code?: string
          created_at?: string
          date_of_birth?: string | null
          date_of_joining?: string
          department_id?: string | null
          designation?: string | null
          email?: string | null
          email_official?: string | null
          email_personal?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          esic_number?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["gender_type"]
          gross_monthly?: number
          hra?: number
          id?: string
          mobile_official?: string | null
          mobile_personal?: string | null
          pan?: string | null
          pf_uan?: string | null
          special_allowance?: number
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      helpdesk_ticket_comments: {
        Row: {
          author_id: string | null
          author_is_staff: boolean
          author_name: string | null
          author_role: string | null
          body: string
          created_at: string
          id: string
          ticket_id: string
        }
        Insert: {
          author_id?: string | null
          author_is_staff?: boolean
          author_name?: string | null
          author_role?: string | null
          body: string
          created_at?: string
          id?: string
          ticket_id: string
        }
        Update: {
          author_id?: string | null
          author_is_staff?: boolean
          author_name?: string | null
          author_role?: string | null
          body?: string
          created_at?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "helpdesk_ticket_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "helpdesk_ticket_comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "helpdesk_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      helpdesk_tickets: {
        Row: {
          body: string | null
          category: string | null
          created_at: string
          employee_id: string | null
          id: string
          resolution_note: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          subject: string
        }
        Insert: {
          body?: string | null
          category?: string | null
          created_at?: string
          employee_id?: string | null
          id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject: string
        }
        Update: {
          body?: string | null
          category?: string | null
          created_at?: string
          employee_id?: string | null
          id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "helpdesk_tickets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          branch_id: string | null
          created_at: string
          holiday_date: string
          id: string
          name: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          holiday_date: string
          id?: string
          name: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          holiday_date?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "holidays_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      item_assignments: {
        Row: {
          assigned_by: string | null
          assigned_date: string
          created_at: string
          employee_code: string | null
          employee_id: string | null
          id: string
          item_id: string
          person_name: string | null
          quantity: number
          remarks: string | null
          returned: boolean
          returned_date: string | null
        }
        Insert: {
          assigned_by?: string | null
          assigned_date?: string
          created_at?: string
          employee_code?: string | null
          employee_id?: string | null
          id?: string
          item_id: string
          person_name?: string | null
          quantity: number
          remarks?: string | null
          returned?: boolean
          returned_date?: string | null
        }
        Update: {
          assigned_by?: string | null
          assigned_date?: string
          created_at?: string
          employee_code?: string | null
          employee_id?: string | null
          id?: string
          item_id?: string
          person_name?: string | null
          quantity?: number
          remarks?: string | null
          returned?: boolean
          returned_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignments_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_assignments_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          brand: string | null
          category: string | null
          created_at: string
          id: string
          item_code: string | null
          item_name: string
          item_type: string
          remarks: string | null
          returnable: boolean
          size_spec: string | null
          status: string
          total_quantity: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          item_code?: string | null
          item_name: string
          item_type?: string
          remarks?: string | null
          returnable?: boolean
          size_spec?: string | null
          status?: string
          total_quantity?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          item_code?: string | null
          item_name?: string
          item_type?: string
          remarks?: string | null
          returnable?: boolean
          size_spec?: string | null
          status?: string
          total_quantity?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      late_marks: {
        Row: {
          auto_half_day: boolean
          created_at: string
          employee_id: string
          id: string
          mark_date: string
        }
        Insert: {
          auto_half_day?: boolean
          created_at?: string
          employee_id: string
          id?: string
          mark_date: string
        }
        Update: {
          auto_half_day?: boolean
          created_at?: string
          employee_id?: string
          id?: string
          mark_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "late_marks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_balances: {
        Row: {
          balance: number
          employee_id: string
          id: string
          type: Database["public"]["Enums"]["leave_type"]
          year: number
        }
        Insert: {
          balance?: number
          employee_id: string
          id?: string
          type: Database["public"]["Enums"]["leave_type"]
          year: number
        }
        Update: {
          balance?: number
          employee_id?: string
          id?: string
          type?: Database["public"]["Enums"]["leave_type"]
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_reads: {
        Row: {
          employee_id: string
          id: string
          notice_id: string
          read_at: string
        }
        Insert: {
          employee_id: string
          id?: string
          notice_id: string
          read_at?: string
        }
        Update: {
          employee_id?: string
          id?: string
          notice_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_reads_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_reads_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
        ]
      }
      notices: {
        Row: {
          body: string | null
          branch_id: string | null
          channel: Database["public"]["Enums"]["notice_channel"]
          created_at: string
          created_by: string | null
          id: string
          pdf_url: string | null
          published_at: string | null
          title: string
        }
        Insert: {
          body?: string | null
          branch_id?: string | null
          channel?: Database["public"]["Enums"]["notice_channel"]
          created_at?: string
          created_by?: string | null
          id?: string
          pdf_url?: string | null
          published_at?: string | null
          title: string
        }
        Update: {
          body?: string | null
          branch_id?: string | null
          channel?: Database["public"]["Enums"]["notice_channel"]
          created_at?: string
          created_by?: string | null
          id?: string
          pdf_url?: string | null
          published_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          link: string | null
          read_at: string | null
          recipient_id: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          link?: string | null
          read_at?: string | null
          recipient_id: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          link?: string | null
          read_at?: string | null
          recipient_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          adjustments_close: string | null
          adjustments_open: string | null
          created_at: string
          drafts_computed_at: string | null
          id: string
          locked_at: string | null
          month_closed_at: string | null
          paid_at: string | null
          period_month: string
          status: Database["public"]["Enums"]["payroll_status"]
          target_minutes: number | null
          working_days: number | null
        }
        Insert: {
          adjustments_close?: string | null
          adjustments_open?: string | null
          created_at?: string
          drafts_computed_at?: string | null
          id?: string
          locked_at?: string | null
          month_closed_at?: string | null
          paid_at?: string | null
          period_month: string
          status?: Database["public"]["Enums"]["payroll_status"]
          target_minutes?: number | null
          working_days?: number | null
        }
        Update: {
          adjustments_close?: string | null
          adjustments_open?: string | null
          created_at?: string
          drafts_computed_at?: string | null
          id?: string
          locked_at?: string | null
          month_closed_at?: string | null
          paid_at?: string | null
          period_month?: string
          status?: Database["public"]["Enums"]["payroll_status"]
          target_minutes?: number | null
          working_days?: number | null
        }
        Relationships: []
      }
      payslip_adjustments: {
        Row: {
          advance_recovery: number
          id: string
          last_month_balance: number
          loss_damage: number
          reimbursement_bonus: number
          remarks: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          advance_recovery?: number
          id: string
          last_month_balance?: number
          loss_damage?: number
          reimbursement_bonus?: number
          remarks?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          advance_recovery?: number
          id?: string
          last_month_balance?: number
          loss_damage?: number
          reimbursement_bonus?: number
          remarks?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payslip_adjustments_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "payslips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslip_adjustments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: {
          basic_earned: number
          created_at: string
          earned_gross: number
          employee_id: string
          esic_employee: number
          esic_employer: number
          hra_earned: number
          id: string
          net_payable: number
          payable_days: number
          payroll_run_id: string
          pdf_url: string | null
          per_day_rate: number
          pf_employee: number
          pf_employer: number
          professional_tax: number
          shortfall_amount: number
          shortfall_minutes: number
          special_earned: number
          status: Database["public"]["Enums"]["payslip_status"]
          target_minutes: number
          updated_at: string
          worked_minutes: number
        }
        Insert: {
          basic_earned?: number
          created_at?: string
          earned_gross?: number
          employee_id: string
          esic_employee?: number
          esic_employer?: number
          hra_earned?: number
          id?: string
          net_payable?: number
          payable_days?: number
          payroll_run_id: string
          pdf_url?: string | null
          per_day_rate?: number
          pf_employee?: number
          pf_employer?: number
          professional_tax?: number
          shortfall_amount?: number
          shortfall_minutes?: number
          special_earned?: number
          status?: Database["public"]["Enums"]["payslip_status"]
          target_minutes?: number
          updated_at?: string
          worked_minutes?: number
        }
        Update: {
          basic_earned?: number
          created_at?: string
          earned_gross?: number
          employee_id?: string
          esic_employee?: number
          esic_employer?: number
          hra_earned?: number
          id?: string
          net_payable?: number
          payable_days?: number
          payroll_run_id?: string
          pdf_url?: string | null
          per_day_rate?: number
          pf_employee?: number
          pf_employer?: number
          professional_tax?: number
          shortfall_amount?: number
          shortfall_minutes?: number
          special_earned?: number
          status?: Database["public"]["Enums"]["payslip_status"]
          target_minutes?: number
          updated_at?: string
          worked_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      policies: {
        Row: {
          body: string
          branch_id: string | null
          category: string | null
          created_at: string
          created_by: string | null
          effective_date: string | null
          id: string
          published: boolean
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          body: string
          branch_id?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          id?: string
          published?: boolean
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          body?: string
          branch_id?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          id?: string
          published?: boolean
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "policies_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_acknowledgements: {
        Row: {
          acknowledged_at: string
          employee_id: string
          id: string
          policy_id: string
        }
        Insert: {
          acknowledged_at?: string
          employee_id: string
          id?: string
          policy_id: string
        }
        Update: {
          acknowledged_at?: string
          employee_id?: string
          id?: string
          policy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_acknowledgements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_acknowledgements_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar: string | null
          branch_id: string | null
          created_at: string
          employee_id: string | null
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          avatar?: string | null
          branch_id?: string | null
          created_at?: string
          employee_id?: string | null
          full_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          avatar?: string | null
          branch_id?: string | null
          created_at?: string
          employee_id?: string | null
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      pt_slabs: {
        Row: {
          amount: number
          created_at: string
          gender: Database["public"]["Enums"]["gender_type"] | null
          id: string
          max_gross: number | null
          min_gross: number
          month: number | null
          state: Database["public"]["Enums"]["indian_state"]
        }
        Insert: {
          amount: number
          created_at?: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string
          max_gross?: number | null
          min_gross?: number
          month?: number | null
          state: Database["public"]["Enums"]["indian_state"]
        }
        Update: {
          amount?: number
          created_at?: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string
          max_gross?: number | null
          min_gross?: number
          month?: number | null
          state?: Database["public"]["Enums"]["indian_state"]
        }
        Relationships: []
      }
      punch_events: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          kind: string
          lat: number | null
          lng: number | null
          punched_at: string
          source: string
          within_geofence: boolean | null
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          kind: string
          lat?: number | null
          lng?: number | null
          punched_at: string
          source?: string
          within_geofence?: boolean | null
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          punched_at?: string
          source?: string
          within_geofence?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "punch_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      reimbursement_claims: {
        Row: {
          amount: number
          claim_date: string
          created_at: string
          description: string
          employee_id: string
          id: string
          kms: number | null
          mode_of_payment: string | null
          purpose: Database["public"]["Enums"]["reimbursement_purpose"]
          remarks: string | null
          review_remark: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_medium: string | null
          status: Database["public"]["Enums"]["reimbursement_status"]
        }
        Insert: {
          amount?: number
          claim_date: string
          created_at?: string
          description: string
          employee_id: string
          id?: string
          kms?: number | null
          mode_of_payment?: string | null
          purpose: Database["public"]["Enums"]["reimbursement_purpose"]
          remarks?: string | null
          review_remark?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_medium?: string | null
          status?: Database["public"]["Enums"]["reimbursement_status"]
        }
        Update: {
          amount?: number
          claim_date?: string
          created_at?: string
          description?: string
          employee_id?: string
          id?: string
          kms?: number | null
          mode_of_payment?: string | null
          purpose?: Database["public"]["Enums"]["reimbursement_purpose"]
          remarks?: string | null
          review_remark?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_medium?: string | null
          status?: Database["public"]["Enums"]["reimbursement_status"]
        }
        Relationships: [
          {
            foreignKeyName: "reimbursement_claims_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursement_claims_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          balance_after: number | null
          created_at: string
          days: number
          employee_id: string
          end_date: string
          id: string
          leave_kind: Database["public"]["Enums"]["leave_type"] | null
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["request_status"]
          type: Database["public"]["Enums"]["request_type"]
        }
        Insert: {
          balance_after?: number | null
          created_at?: string
          days?: number
          employee_id: string
          end_date: string
          id?: string
          leave_kind?: Database["public"]["Enums"]["leave_type"] | null
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["request_status"]
          type: Database["public"]["Enums"]["request_type"]
        }
        Update: {
          balance_after?: number | null
          created_at?: string
          days?: number
          employee_id?: string
          end_date?: string
          id?: string
          leave_kind?: Database["public"]["Enums"]["leave_type"] | null
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["request_status"]
          type?: Database["public"]["Enums"]["request_type"]
        }
        Relationships: [
          {
            foreignKeyName: "requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          branch_id: string | null
          description: string | null
          key: string
          label: string | null
          updated_at: string
          value: Json
        }
        Insert: {
          branch_id?: string | null
          description?: string | null
          key: string
          label?: string | null
          updated_at?: string
          value: Json
        }
        Update: {
          branch_id?: string | null
          description?: string | null
          key?: string
          label?: string | null
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_asset_summary: {
        Row: {
          assigned: number | null
          available: number | null
          category: string | null
          total: number | null
          warranty_expiring: number | null
        }
        Relationships: []
      }
      v_celebrations: {
        Row: {
          branch: string | null
          code: string | null
          department: string | null
          full_name: string | null
          id: string | null
          kind: string | null
          years: number | null
        }
        Relationships: []
      }
      v_items: {
        Row: {
          brand: string | null
          category: string | null
          created_at: string | null
          id: string | null
          item_code: string | null
          item_name: string | null
          quantity_assigned: number | null
          quantity_remaining: number | null
          remarks: string | null
          returnable: boolean | null
          size_spec: string | null
          status: string | null
          total_quantity: number | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          brand?: string | null
          category?: string | null
          created_at?: string | null
          id?: string | null
          item_code?: string | null
          item_name?: string | null
          quantity_assigned?: never
          quantity_remaining?: never
          remarks?: string | null
          returnable?: boolean | null
          size_spec?: string | null
          status?: string | null
          total_quantity?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          brand?: string | null
          category?: string | null
          created_at?: string | null
          id?: string | null
          item_code?: string | null
          item_name?: string | null
          quantity_assigned?: never
          quantity_remaining?: never
          remarks?: string | null
          returnable?: boolean | null
          size_spec?: string | null
          status?: string | null
          total_quantity?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      v_monthly_attendance_summary: {
        Row: {
          absents: number | null
          employee_id: string | null
          field_days: number | null
          half_days: number | null
          holidays: number | null
          late_marks: number | null
          leaves: number | null
          period_month: string | null
          present: number | null
          week_offs: number | null
          worked_minutes: number | null
          working_days: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_days_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      v_today_board: {
        Row: {
          absent: number | null
          branch: string | null
          field: number | null
          headcount: number | null
          present: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      cron_claim: {
        Args: { p_detail?: string; p_job: string; p_key: string }
        Returns: boolean
      }
      current_employee_id: { Args: never; Returns: string }
      fn_auto_close_prev_month: { Args: never; Returns: boolean }
      fn_auto_punch_out: { Args: { target: string }; Returns: number }
      fn_auto_punch_out_time: { Args: never; Returns: string }
      fn_compute_payslip: {
        Args: { p_employee_id: string; p_run_id: string }
        Returns: undefined
      }
      fn_compute_run: { Args: { p_run_id: string }; Returns: undefined }
      fn_lock_run: { Args: { p_run_id: string }; Returns: undefined }
      fn_mark_run_paid: { Args: { p_run_id: string }; Returns: undefined }
      fn_professional_tax: {
        Args: {
          p_gender: Database["public"]["Enums"]["gender_type"]
          p_gross: number
          p_month: number
          p_state: Database["public"]["Enums"]["indian_state"]
        }
        Returns: number
      }
      fn_purge_old_notices: { Args: never; Returns: number }
      fn_setting_numeric: {
        Args: { p_default: number; p_key: string }
        Returns: number
      }
      fn_warranty_reminders: { Args: never; Returns: number }
      is_authenticated: { Args: never; Returns: boolean }
      is_portal: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "hr" | "manager" | "viewer" | "employee"
      attendance_status:
        | "P"
        | "LM"
        | "HD"
        | "L"
        | "WO"
        | "OH"
        | "AB"
        | "S"
        | "T"
        | "CO"
      comp_off_status: "available" | "applied" | "used" | "expired"
      employee_status: "active" | "on_notice" | "inactive"
      gender_type: "Male" | "Female" | "Other"
      indian_state: "Maharashtra" | "Gujarat"
      leave_type: "PL" | "CL" | "SL" | "LWP"
      notice_channel: "app" | "whatsapp" | "both"
      notification_kind:
        | "notice"
        | "policy"
        | "request"
        | "approval"
        | "reimbursement"
        | "comp_off"
        | "ticket"
        | "payroll"
        | "system"
        | "asset"
        | "item"
        | "warranty"
      payroll_status: "draft" | "in_review" | "locked" | "paid"
      payslip_status: "draft" | "queued" | "generated" | "paid"
      reimbursement_purpose: "travel" | "material_purchase" | "other"
      reimbursement_status: "pending" | "approved" | "rejected" | "paid"
      request_status: "pending" | "approved" | "rejected" | "cancelled"
      request_type: "leave" | "site_visit" | "outdoor_duty" | "wfh" | "comp_off"
      ticket_status: "open" | "in_progress" | "resolved" | "closed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "hr", "manager", "viewer", "employee"],
      attendance_status: [
        "P",
        "LM",
        "HD",
        "L",
        "WO",
        "OH",
        "AB",
        "S",
        "T",
        "CO",
      ],
      comp_off_status: ["available", "applied", "used", "expired"],
      employee_status: ["active", "on_notice", "inactive"],
      gender_type: ["Male", "Female", "Other"],
      indian_state: ["Maharashtra", "Gujarat"],
      leave_type: ["PL", "CL", "SL", "LWP"],
      notice_channel: ["app", "whatsapp", "both"],
      notification_kind: [
        "notice",
        "policy",
        "request",
        "approval",
        "reimbursement",
        "comp_off",
        "ticket",
        "payroll",
        "system",
        "asset",
        "item",
        "warranty",
      ],
      payroll_status: ["draft", "in_review", "locked", "paid"],
      payslip_status: ["draft", "queued", "generated", "paid"],
      reimbursement_purpose: ["travel", "material_purchase", "other"],
      reimbursement_status: ["pending", "approved", "rejected", "paid"],
      request_status: ["pending", "approved", "rejected", "cancelled"],
      request_type: ["leave", "site_visit", "outdoor_duty", "wfh", "comp_off"],
      ticket_status: ["open", "in_progress", "resolved", "closed"],
    },
  },
} as const
