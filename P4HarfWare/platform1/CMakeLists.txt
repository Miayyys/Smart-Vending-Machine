cmake_minimum_required(VERSION 3.16)

# esp-dl neural network inference library
list(APPEND EXTRA_COMPONENT_DIRS "/path/to/esp-dl/esp-dl")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(wifi_test)

# Flash .espdl model to the "model_0" partition (default active slot)
if(CONFIG_PARTITION_TABLE_CUSTOM)
    set(MODEL_FILE "${CMAKE_CURRENT_LIST_DIR}/main/yolo/yolo11n_SVM.espdl")
    if(EXISTS ${MODEL_FILE})
        esptool_py_flash_to_partition(flash "model_0" "${MODEL_FILE}")
        message(STATUS "Model will be flashed to 'model_0' partition: ${MODEL_FILE}")
    endif()
endif()
