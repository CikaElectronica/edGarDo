#include "esp32_bt_gap.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_bt.h"
#include "esp_bt_defs.h"
#include "esp_bt_device.h"
#include "esp_gap_ble_api.h"

#include "frozen.h"
#include "mgos_bt.h"

#include "mgos_rpc.h"
#include "mgos.h"


bool my_bt_gap_remove_bond_device(struct mgos_bt_addr *addr);
/*
 * Return list of bond devices; the caller should free it.
 */
bool my_bt_gap_get_bond_device_list(int *dev_num, struct mgos_bt_addr *list);


bool my_bt_gap_remove_bond_device(struct mgos_bt_addr *addr) {
    return (esp_ble_remove_bond_device(/*(esp_bd_addr_t)*/ addr->addr) == ESP_OK);
}

bool my_bt_gap_get_bond_device_list(int *dev_num, struct mgos_bt_addr *list) {
esp_ble_bond_dev_t *dev_list;
bool rc = true;

    if(*dev_num == 0)
        return false;
    if((dev_list = calloc(*dev_num, sizeof(esp_ble_bond_dev_t))) == NULL)
        return false;
    if(esp_ble_get_bond_device_list(dev_num, dev_list) == ESP_OK) {
        for(int i=0; i<*dev_num; i++) {
            memcpy(&list->addr, &dev_list[i].bd_addr, sizeof(esp_bd_addr_t));
            list->type = MGOS_BT_ADDR_TYPE_NONE;
            ++list;
        }
    } else rc = false;
    free(dev_list);
    return rc;
}

int my_print_bond_info(struct json_out *out) {
int len;
int num;
struct mgos_bt_addr *addr = NULL;

    if((num = mgos_bt_gap_get_num_paired_devices()) > 0) {
        addr = calloc(num, sizeof(struct mgos_bt_addr));
        if(my_bt_gap_get_bond_device_list(&num, addr) == false) {
            num = -1;
       }
    }
    len = json_printf(out, "{num: %d", num);
    if(num > 0) {
        char buf[MGOS_BT_ADDR_STR_LEN];
        len += json_printf(out, ", addr: [");
        for(int i=0; i<num; i++) {
            if(i)
                len += json_printf(out, ",");
            len += json_printf(out, "%Q", mgos_bt_addr_to_str(&addr[i], 0, buf));
        }
        len += json_printf(out, "]");
    }
    len += json_printf(out, "}");
    if(addr) free(addr);
    return len;
}



static void my_rpc_bond_list_handler(struct mg_rpc_request_info *ri,
                                      void *cb_arg,
                                      struct mg_rpc_frame_info *fi,
                                      struct mg_str args) {
    mg_rpc_send_responsef(ri, "%M", (json_printf_callback_t) my_print_bond_info);
    (void) cb_arg;
    (void) args;
    (void) fi;
}

static void my_rpc_bond_delete_addr_handler(struct mg_rpc_request_info *ri,
                                      void *cb_arg,
                                      struct mg_rpc_frame_info *fi,
                                      struct mg_str args) {
char *addr_str = NULL;
struct mgos_bt_addr addr;

    if ((json_scanf(args.p, args.len, ri->args_fmt, &addr_str) == 1) &&
          mgos_bt_addr_from_str(mg_mk_str(addr_str), &addr)) {
        if(my_bt_gap_remove_bond_device(&addr))
            mg_rpc_send_responsef(ri, "{rc: OK}");
        else
            mg_rpc_send_responsef(ri, "{rc: ERROR}");
    } else {
        mg_rpc_send_errorf(ri, -1, "Bad request. Expected: {\"addr\": \"<addr>\"}");
    }
    if(addr_str) free(addr_str);
    (void) cb_arg;
    (void) args;
    (void) fi;
}



enum mgos_app_init_result mgos_app_init(void) {
    mg_rpc_add_handler(mgos_rpc_get_global(), "Bond.List", "", my_rpc_bond_list_handler, NULL);
    mg_rpc_add_handler(mgos_rpc_get_global(), "Bond.Erase", "{addr: %Q}", my_rpc_bond_delete_addr_handler, NULL);

    return MGOS_APP_INIT_SUCCESS;
}
